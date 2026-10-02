import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { compileScenario } from "../scenario/compile";
import { createModelRegistry, defineModelFactory } from "../scenario/registry";
import type { ScenarioV1 } from "../scenario/types";
import { parseSimStateJSON, serializeSimState } from "../serde/simState";
import {
  checkJsonRoundTrip,
  checkReplay,
  checkSnapshots,
  checkTrialOrder,
  snapshotEconomy,
} from "../testkit/conformanceRun";
import { simulateMonteCarlo } from "./monteCarlo";
import {
  cloneRunState,
  createRunFactory,
  createStreamRng,
  deriveStreamSeed,
  executionPlanIdentity,
  executionStream,
  previewStream,
  RunIsolationError,
  type ExecutionPlan,
} from "./runFactory";
import { simulateSessionPattern, type SessionPatternId } from "./session";
import { runScenario } from "./simulator";
import { createStrategyRegistry, type StrategyFactory } from "./strategy/registry";
import { createScriptedStrategy } from "./strategy/scripted";
import type { Strategy } from "./strategy/types";
import type { Action, CompiledScenario, Model, SimContext, SimState } from "./types";

type UnitCode = "COIN";

/** Repro label. Draws use this seed plus the logical trial id. The label is not a stream draw. */
export const runLifecycleCaseSeed = 0x7103;

function context<Vars>(stepSec: number): SimContext<number, UnitCode, Vars> {
  return {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    stepSec,
  };
}

function state<Vars>(stepSec: number, vars: Vars): SimState<number, UnitCode, Vars> {
  const ctx = context<Vars>(stepSec);
  return {
    t: 0,
    wallet: { money: { unit: ctx.unit, amount: 0 }, bucket: 0 },
    maxMoneyEver: { unit: ctx.unit, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars,
  };
}

function action(id: string): Action<number, UnitCode, { applied: string[] }> {
  return {
    id,
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({
      ...current,
      vars: { applied: [...current.vars.applied, id] },
    }),
  };
}

function recordingModel(): Model<number, UnitCode, { applied: string[] }> {
  const ids = ["a0", "a1", "a2", "a3"];
  return {
    id: "record",
    version: 1,
    income: (ctx) => ({ unit: ctx.unit, amount: 0 }),
    actions: () => ids.map((id) => action(id)),
  };
}

function buyModel(): Model<number, UnitCode, { buys: number }> {
  return {
    id: "buy",
    version: 1,
    income: (ctx) => ({ unit: ctx.unit, amount: 0 }),
    actions: () => [
      {
        id: "buy",
        kind: "custom",
        canApply: () => true,
        cost: () => null,
        apply: (_ctx, current) => ({
          ...current,
          vars: { buys: current.vars.buys + 1 },
        }),
      },
    ],
  };
}

function compiled<Vars>(args: {
  stepSec: number;
  durationSec: number;
  vars: Vars;
  model: Model<number, UnitCode, Vars>;
  strategy?: Strategy<number, UnitCode, Vars>;
}): CompiledScenario<number, UnitCode, Vars> {
  return {
    ctx: context<Vars>(args.stepSec),
    model: args.model,
    initial: state(args.stepSec, args.vars),
    strategy: args.strategy,
    run: { stepSec: args.stepSec, durationSec: args.durationSec },
  };
}

function scriptedFactory(): StrategyFactory {
  return {
    id: "scripted",
    create: (params) => createScriptedStrategy(params as Parameters<typeof createScriptedStrategy>[0]),
  };
}

function statefulIncomeFactory() {
  return defineModelFactory<number, UnitCode, { calls: number }>({
    id: "stateful-income",
    version: 1,
    create: () => {
      let calls = 0;
      return {
        id: "stateful-income",
        version: 1,
        income: (ctx) => {
          calls += 1;
          return { unit: ctx.unit, amount: calls };
        },
        actions: () => [],
      };
    },
  });
}

/**
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation Runs a fresh scripted draw twice, a stateful model in both orders, one continued session, a frozen vars input, and an unisolated closure.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #f73792f Re-read the section, then ran this function: a second scripted draw still buys once, stateful income stays at 3 in both orders, twice-daily applies a0 through a3, and a frozen vars input stays at 0.
 * @evidence ./runFactory.ts#executionStream Reads the committed stream name and derives it from trial id 0x7103.
 * @evidenceReview ./runFactory.ts#executionStream #0a4e437 The declaration is the string execution. This test derives that stream from trial id rng and seed 0x7103.
 * @evidence ./runFactory.ts#previewStream Reads the preview stream name and refuses to restore it onto the committed stream.
 * @evidenceReview ./runFactory.ts#previewStream #56b129a The declaration is the string preview. This test refuses to restore that snapshot onto the execution RNG.
 */
export function isolatesIndependentRuns(): void {
  expect(executionStream).toBe("execution");
  expect(previewStream).toBe("preview");
  expect(runLifecycleCaseSeed).toBe(0x7103);
  expect(deriveStreamSeed(runLifecycleCaseSeed, "a", executionStream)).toBe(
    deriveStreamSeed(runLifecycleCaseSeed, "a", executionStream),
  );
  expect(deriveStreamSeed(runLifecycleCaseSeed, "a", executionStream)).not.toBe(
    deriveStreamSeed(runLifecycleCaseSeed, "a", previewStream),
  );
  expect(deriveStreamSeed(runLifecycleCaseSeed, "a", executionStream)).not.toBe(
    deriveStreamSeed(runLifecycleCaseSeed, "b", executionStream),
  );

  const scripted = createScriptedStrategy<number, UnitCode, { buys: number }>({
    schemaVersion: 1,
    loop: false,
    program: [{ actionId: "buy" }],
  });
  const repeated = compiled({
    stepSec: 1,
    durationSec: 3,
    vars: { buys: 0 },
    model: buyModel(),
    strategy: scripted,
  });
  const buysOf = () =>
    simulateMonteCarlo({
      scenario: repeated,
      draws: 1,
      seed: runLifecycleCaseSeed,
      metrics: ({ run }) => run.end.vars.buys,
    }).results[0]?.metrics;
  expect(buysOf()).toBe(1);
  expect(buysOf()).toBe(1);
  expect(scripted.snapshotState?.()).toEqual({ cursor: 0 });
  const many = simulateMonteCarlo({
    scenario: repeated,
    draws: 3,
    seed: runLifecycleCaseSeed,
    metrics: ({ run }) => run.end.vars.buys,
  });
  expect(many.results.map((result) => result.metrics)).toEqual([1, 1, 1]);

  const incomeFactory = statefulIncomeFactory();
  const incomeRegistry = createModelRegistry([incomeFactory]);
  const incomeScenario = compiled({
    stepSec: 1,
    durationSec: 2,
    vars: { calls: 0 },
    model: {
      id: "placeholder",
      version: 1,
      income: (ctx) => ({ unit: ctx.unit, amount: 0 }),
      actions: () => [],
    },
  });
  const isolation = { model: { id: "stateful-income", version: 1 }, statefulModel: true as const };
  const registries = { models: incomeRegistry };
  const drawMoney = (draws: number) =>
    simulateMonteCarlo({
      scenario: incomeScenario,
      draws,
      seed: runLifecycleCaseSeed,
      registries,
      isolation,
      metrics: ({ run }) => run.end.wallet.money.amount,
    });
  expect(drawMoney(1).results[0]?.metrics).toBe(3);
  const three = drawMoney(3);
  expect(three.results.map((result) => result.metrics)).toEqual([3, 3, 3]);

  const orderBinding = createRunFactory(registries).bind(incomeScenario, isolation);
  const trialSnapshot = (seed: number) =>
    snapshotEconomy(
      incomeScenario.ctx.E,
      runScenario(orderBinding.fresh({ trialId: String(seed), seed }).scenario).end,
    );
  const order = checkTrialOrder(trialSnapshot, [1, 2]);
  if (!order.ok) throw new Error(order.summary);
  const alone = trialSnapshot(7);
  orderBinding.fresh({ trialId: "8", seed: 8 });
  runScenario(orderBinding.fresh({ trialId: "8", seed: 8 }).scenario);
  const afterOther = trialSnapshot(7);
  const sameTrial = checkSnapshots(alone, afterOther, "same");
  if (!sameTrial.ok) throw new Error(sameTrial.summary);
  const first = orderBinding.fresh({ trialId: "left", seed: 1 });
  const second = orderBinding.fresh({ trialId: "right", seed: 1 });
  expect(first.scenario.model).not.toBe(second.scenario.model);
  expect(first.scenario.initial.vars).not.toBe(second.scenario.initial.vars);
  expect(first.scenario.initial.vars).not.toBe(incomeScenario.initial.vars);
  orderBinding.release();

  const cursor = createScriptedStrategy<number, UnitCode, { applied: string[] }>({
    schemaVersion: 1,
    loop: false,
    program: [{ actionId: "a0" }, { actionId: "a1" }, { actionId: "a2" }, { actionId: "a3" }],
  });
  const sessionScenario = compiled({
    stepSec: 86400,
    durationSec: 86400,
    vars: { applied: [] },
    model: recordingModel(),
    strategy: cursor,
  });
  const sessionBinding = createRunFactory().bind(sessionScenario);
  const patternOf = (id: SessionPatternId) => {
    const instance = sessionBinding.fresh({ trialId: id, seed: runLifecycleCaseSeed });
    const session = simulateSessionPattern({
      scenario: instance.scenario,
      pattern: { id, days: 1 },
    });
    return session.end.vars.applied.join(",");
  };
  const daily = patternOf("twice-daily");
  const heavy = patternOf("offline-heavy");
  expect(daily).toBe("a0,a1,a2,a3");
  expect(heavy).toBe("a0,a1");
  expect(patternOf("offline-heavy")).toBe(heavy);
  expect(patternOf("twice-daily")).toBe(daily);
  sessionBinding.release();

  const play = createScriptedStrategy<number, UnitCode, { applied: string[] }>({
    schemaVersion: 1,
    loop: false,
    program: [{ actionId: "a0" }, { actionId: "a1" }],
  });
  const playScenario = compiled({
    stepSec: 1,
    durationSec: 1,
    vars: { applied: [] },
    model: recordingModel(),
    strategy: play,
  });
  const playBinding = createRunFactory().bind(playScenario);
  const started = playBinding.fresh({ trialId: "play", seed: 1 });
  const head = runScenario(started.scenario);
  expect(play.snapshotState?.()).toEqual({ cursor: 1 });
  const continued = playBinding.continue(started, { state: head.end });
  expect(continued.mode).toBe("continue");
  expect(continued.scenario.strategy).toBe(play);
  expect(continued.scenario.model).toBe(started.scenario.model);
  expect(play.snapshotState?.()).toEqual({ cursor: 1 });
  expect(continued.rng).toBe(started.rng);
  runScenario(continued.scenario);
  expect(play.snapshotState?.()).toEqual({ cursor: 2 });
  const checkpoint = continued.checkpoint();
  expect(checkpoint.runner).toBeUndefined();
  expect(checkpoint.strategy?.state).toEqual({ cursor: 2 });
  play.restoreState?.({ cursor: 0 });
  const resumed = playBinding.resume({ checkpoint, state: head.end });
  expect(resumed.mode).toBe("resume");
  expect(play.snapshotState?.()).toEqual({ cursor: 2 });
  expect(resumed.scenario.initial).not.toBe(head.end);
  const restarted = playBinding.fresh({ trialId: "play", seed: 1 });
  expect(restarted.mode).toBe("fresh");
  expect(play.snapshotState?.()).toEqual({ cursor: 0 });
  playBinding.release();

  const strategies = createStrategyRegistry([scriptedFactory()]);
  const separate = createRunFactory({ strategies }).bind(
    compiled({
      stepSec: 1,
      durationSec: 1,
      vars: { applied: [] },
      model: recordingModel(),
    }),
    {
      strategy: {
        id: "scripted",
        params: {
          schemaVersion: 1,
          loop: false,
          program: [{ actionId: "a0" }, { actionId: "a1" }],
        },
      },
    },
  );
  const left = separate.fresh({ trialId: "1", seed: 1 });
  const right = separate.fresh({ trialId: "2", seed: 1 });
  expect(left.scenario.strategy).not.toBe(right.scenario.strategy);
  expect(left.observer.trialId).not.toBe(right.observer.trialId);
  expect(left.observer.buffer).toBe("per-run");
  runScenario(left.scenario);
  runScenario(right.scenario);
  expect(left.scenario.strategy?.snapshotState?.()).toEqual({ cursor: 1 });
  expect(right.scenario.strategy?.snapshotState?.()).toEqual({ cursor: 1 });
  const carried = separate.continue(left, { state: left.scenario.initial });
  expect(carried.scenario.strategy).not.toBe(left.scenario.strategy);
  expect(carried.scenario.strategy?.snapshotState?.()).toEqual({ cursor: 1 });
  separate.release();

  const hidden: Strategy<number, UnitCode, { buys: number }> = {
    id: "hidden",
    decide: () => [],
  };
  expect(() =>
    createRunFactory().bind(
      compiled({ stepSec: 1, durationSec: 1, vars: { buys: 0 }, model: buyModel(), strategy: hidden }),
      { statefulStrategy: true },
    ),
  ).toThrow(RunIsolationError);
  expect(() => createRunFactory().bind(incomeScenario, { statefulModel: true })).toThrow(
    /Deep-cloning a function closure is not isolation/,
  );

  const engine = repeated.ctx.E;
  const zero = engine.zero();
  expect(engine.toNumber(engine.add(zero, engine.from(4)))).toBe(4);
  expect(engine.toNumber(zero)).toBe(0);

  const rngBinding = createRunFactory().bind(repeated);
  const rngRun = rngBinding.fresh({ trialId: "rng", seed: runLifecycleCaseSeed });
  expect(rngRun.scenario.ctx.E).toBe(engine);
  expect(rngRun.scenario.ctx).not.toBe(repeated.ctx);
  expect(repeated.ctx.seed).toBeUndefined();
  expect(rngRun.streams.execution).toBe(deriveStreamSeed(runLifecycleCaseSeed, "rng", executionStream));
  expect(rngRun.streams.preview).toBe(deriveStreamSeed(runLifecycleCaseSeed, "rng", previewStream));
  const firstDraw = rngRun.rng.next();
  const snap = rngRun.rng.snapshot();
  const secondDraw = rngRun.rng.next();
  rngRun.rng.restore(snap);
  expect(rngRun.rng.next()).toBe(secondDraw);
  const previewSnap = rngRun.preview.snapshot();
  rngRun.rng.next();
  expect(rngRun.preview.snapshot()).toEqual(previewSnap);
  expect(() => rngRun.rng.restore(rngRun.preview.snapshot())).toThrow(/stream/);
  const clonedSnap = cloneRunState({
    ...state(1, { rng: snap }),
  }).vars.rng;
  rngRun.rng.restore(clonedSnap);
  expect(rngRun.rng.next()).toBe(secondDraw);
  expect(firstDraw).not.toBe(secondDraw);
  rngBinding.release();

  const direct = createStreamRng(executionStream, 5);
  const origin = direct.snapshot();
  const led = direct.next();
  direct.next();
  direct.restore(origin);
  expect(direct.next()).toBe(led);

  const plan: ExecutionPlan = {
    contract: "idlekit.execution-plan",
    version: 1,
    stepSec: 2,
    durationSec: 4,
    seed: 9,
  };
  expect(executionPlanIdentity(plan)).toBe(executionPlanIdentity({ ...plan }));
  expect(executionPlanIdentity(plan)).not.toBe(executionPlanIdentity({ ...plan, stepSec: 3 }));
  const planned = createRunFactory({ strategies }).bind(repeated).fresh({
    trialId: "plan",
    plan: {
      ...plan,
      strategyId: "scripted",
      strategyParams: { schemaVersion: 1, loop: false, program: [{ actionId: "buy" }] },
    },
  });
  expect(planned.seed).toBe(9);
  expect(planned.scenario.run.stepSec).toBe(2);
  expect(planned.scenario.run.durationSec).toBe(4);
  expect(planned.scenario.strategy?.id).toBe("scripted");
  expect(planned.scenario.ctx).not.toBe(repeated.ctx);
  const saved = serializeSimState(engine, planned.scenario.initial, { seed: planned.seed, engineName: "number" });
  expect(saved.v).toBe(1);
  expect("runner" in saved).toBe(false);
  expect(planned.checkpoint().runner).toBeUndefined();
  const legacy = parseSimStateJSON({
    v: 1,
    unit: "COIN",
    t: 0,
    wallet: { amount: "0", bucket: "0" },
    maxMoneyEver: "0",
    prestige: { count: 0, points: "0", multiplier: "1" },
    vars: { buys: 0 },
  });
  expect(legacy.v).toBe(1);
  expect(legacy.strategy).toBeUndefined();
  expect(() =>
    createRunFactory().bind(repeated).fresh({
      trialId: "bad-plan",
      seed: 1,
      plan: { contract: "idlekit.other", version: 1, stepSec: 1 } as unknown as ExecutionPlan,
    }),
  ).toThrow(/ExecutionPlan/);

  const quiet = compiled({
    stepSec: 1,
    durationSec: 2,
    vars: { buys: 0 },
    model: {
      id: "constant",
      version: 1,
      income: (ctx) => ({ unit: ctx.unit, amount: 1 }),
      actions: () => [],
    },
  });
  const replay = checkReplay(quiet);
  if (!replay.ok) throw new Error(replay.summary);
  const roundTrip = checkJsonRoundTrip(quiet);
  if (!roundTrip.ok) throw new Error(roundTrip.summary);
  const digestBinding = createRunFactory().bind(quiet);
  const leftDigest = snapshotEconomy(quiet.ctx.E, runScenario(digestBinding.fresh({ trialId: "same", seed: 4 }).scenario).end);
  const rightDigest = snapshotEconomy(
    quiet.ctx.E,
    runScenario(digestBinding.fresh({ trialId: "same", seed: 4 }).scenario).end,
  );
  const digests = checkSnapshots(leftDigest, rightDigest, "same");
  if (!digests.ok) throw new Error(digests.summary);
  digestBinding.release();

  class Gem {
    constructor(readonly n: number) {}
  }
  const inputVars = { owned: 0, gem: new Gem(2) };
  Object.freeze(inputVars);
  const modelFactory = defineModelFactory<number, UnitCode, { owned: number; gem: Gem }>({
    id: "m",
    version: 1,
    create: () => ({
      id: "m",
      version: 1,
      income: (ctx) => ({ unit: ctx.unit, amount: 0 }),
      evolve: (_ctx, current) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + 1 },
      }),
      actions: () => [],
    }),
  });
  const scenarioJson: ScenarioV1 = {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount: "0" },
      vars: inputVars,
    },
    clock: { stepSec: 1, durationSec: 1 },
  };
  Object.freeze(scenarioJson.initial);
  const built = compileScenario<number, UnitCode, { owned: number; gem: Gem }>({
    E: createNumberEngine(),
    scenario: scenarioJson,
    registry: createModelRegistry([modelFactory]),
    unitFactory: (code) => ({ code: code as UnitCode }),
  });
  expect(built.initial.vars).not.toBe(inputVars);
  expect(built.initial.vars.gem).toBeInstanceOf(Gem);
  expect(built.initial.vars.gem).not.toBe(inputVars.gem);
  expect(built.initial.vars.gem.n).toBe(2);
  const frozenRun = createRunFactory().bind(built).fresh({ trialId: "freeze", seed: 1 });
  expect(frozenRun.scenario.initial.vars).not.toBe(built.initial.vars);
  const froze = runScenario(frozenRun.scenario);
  expect(inputVars.owned).toBe(0);
  expect(built.initial.vars.owned).toBe(0);
  expect(frozenRun.scenario.initial.vars.owned).toBe(0);
  expect(froze.end.vars.owned).toBe(1);
  expect(froze.end.vars.gem).toBeInstanceOf(Gem);
}

describe("PR-03 run lifecycle isolation", () => {
  it("isolates independent runs", isolatesIndependentRuns);
});

describe("run factory review fixes", () => {
  it("shares a strategy with one snapshot hook unless stateful isolation is asked for", () => {
    const halves: Strategy<number, UnitCode, { buys: number }>[] = [
      { id: "snapshot-only", snapshotState: () => ({ cursor: 0 }), decide: () => [] },
      { id: "restore-only", restoreState: () => {}, decide: () => [] },
    ];
    for (const half of halves) {
      const scenario = compiled({ stepSec: 1, durationSec: 2, vars: { buys: 0 }, model: buyModel(), strategy: half });
      const summary = simulateMonteCarlo({
        scenario,
        draws: 2,
        seed: 1,
        metrics: ({ run }) => run.end.vars.buys,
      });
      expect(summary.results.map((result) => result.metrics)).toEqual([0, 0]);
      expect(createRunFactory().bind(scenario).fresh({ trialId: "a", seed: 1 }).scenario.strategy).toBe(half);
      expect(() => createRunFactory().bind(scenario, { statefulStrategy: true })).toThrow(RunIsolationError);
      expect(() =>
        simulateMonteCarlo({
          scenario,
          draws: 1,
          seed: 1,
          isolation: { statefulStrategy: true },
          metrics: () => 0,
        }),
      ).toThrow(RunIsolationError);
    }
  });
  it("keeps the draw failure when releasing the strategy also fails", () => {
    let broken = false;
    const fragile: Strategy<number, UnitCode, { buys: number }> = {
      id: "fragile",
      snapshotState: () => ({ cursor: 0 }),
      restoreState: () => {
        if (broken) throw new Error("restore failed");
      },
      decide: () => [],
    };
    const scenario = compiled({ stepSec: 1, durationSec: 1, vars: { buys: 0 }, model: buyModel(), strategy: fragile });
    expect(() =>
      simulateMonteCarlo({
        scenario,
        draws: 1,
        seed: 1,
        metrics: () => {
          broken = true;
          throw new Error("draw failed");
        },
      }),
    ).toThrow("draw failed");
    broken = false;
    expect(() =>
      simulateMonteCarlo({
        scenario,
        draws: 1,
        seed: 1,
        metrics: () => {
          broken = true;
          return 0;
        },
      }),
    ).toThrow("restore failed");
  });
  it("checks bound strategy and model params against the factory schema", () => {
    const positive = {
      "~standard": {
        validate: (input: unknown) =>
          typeof (input as { n?: unknown })?.n === "number" && (input as { n: number }).n > 0
            ? { success: true as const, value: input }
            : { success: false as const, issues: [{ message: "n must be positive" }] },
      },
    };
    const created: unknown[] = [];
    const strategies = createStrategyRegistry([
      {
        id: "checked",
        paramsSchema: positive,
        create: (params) => {
          created.push(params);
          return { id: "checked", decide: () => [] };
        },
      },
    ]);
    const models = createModelRegistry([
      defineModelFactory<number, UnitCode, { buys: number }>({
        id: "checked-model",
        version: 1,
        paramsSchema: positive,
        create: (params) => {
          created.push(params);
          return buyModel();
        },
      }),
    ]);
    const scenario = compiled({ stepSec: 1, durationSec: 1, vars: { buys: 0 }, model: buyModel() });
    const factory = createRunFactory({ strategies, models });
    expect(() => factory.bind(scenario, { strategy: { id: "checked", params: { n: 0 } } })).toThrow(
      "Invalid strategy params: n must be positive",
    );
    expect(() => factory.bind(scenario, { model: { id: "checked-model", version: 1, params: { n: -1 } } })).toThrow(
      "Invalid model params: n must be positive",
    );
    expect(created).toEqual([]);
    const ok = factory
      .bind(scenario, { strategy: { id: "checked", params: { n: 1 } }, model: { id: "checked-model", version: 1, params: { n: 2 } } })
      .fresh({ trialId: "ok", seed: 1 });
    expect(ok.scenario.strategy?.id).toBe("checked");
    expect(created).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
