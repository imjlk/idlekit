import {
  BREAK_ETERNITY_EXPERIMENTAL_MESSAGE,
  builtinStrategyFactories,
  compileScenario,
  createBreakInfinityEngine,
  createModelRegistry,
  createNumberEngine,
  createScriptedStrategy,
  createStrategyRegistry,
  runScenario,
  simulateSessionPattern,
  type ModelFactory,
  type ScenarioV1,
  type StrategyFactory,
} from "@idlekit/core";
import { describe, expect, it } from "bun:test";
import {
  effectiveRunHash,
  pluginDigestValues,
  prepareResolvedRun,
  resolveEffectiveEngine,
  resolvedRunContract,
  sessionCaseSeed,
} from "./runConfiguration";

const modelFactory: ModelFactory = {
  id: "m",
  version: 1,
  create: () => ({
    id: "m",
    version: 1,
    income: (ctx: any) => {
      const seen = (ctx as { seen?: number[] }).seen;
      if (seen && ctx.stepSec !== undefined) seen.push(ctx.stepSec);
      return { unit: ctx.unit, amount: ctx.E.from(0) };
    },
    actions: (ctx: any) => [
      {
        id: "buy",
        kind: "buy" as const,
        actor: "automation" as const,
        canApply: () => true,
        cost: () => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
        apply: (_ctx: any, state: any) => ({
          ...state,
          vars: { ...state.vars, bought: Number((state.vars as { bought?: number }).bought ?? 0) + 1 },
        }),
      },
    ],
  }),
};

const customStrategy: StrategyFactory = {
  id: "custom.once",
  defaultParams: { schemaVersion: 1, program: [{ actionId: "buy" }], loop: false, onCannotApply: "stop" },
  create: (params) => createScriptedStrategy(params),
};

function scenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount: "10" },
      vars: { bought: 0 },
    },
    clock: { stepSec: 1, durationSec: 1, untilExpr: "t >= 1" },
    strategy: { id: "greedy" },
    engine: { name: "breakInfinity", version: "metadata-only" },
    design: { sessionPattern: { id: "offline-heavy", days: 1 } },
  };
}

function registries() {
  return {
    modelRegistry: createModelRegistry([modelFactory]),
    strategyRegistry: createStrategyRegistry([...builtinStrategyFactories, customStrategy]),
  };
}

/**
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run Runs the shared plan, fresh stages, engine selection, suffix goal, and directory-independent digest.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #01b9284 Re-read the section, then ran this function: both stages buy once, breakInfinity keeps 1e400 finite, and the digest ignores the directory.
 * @evidence ./runConfiguration.ts#resolvedRunContract Reads the resolved-run contract and checks a fresh stage against a standalone open.
 * @evidenceReview ./runConfiguration.ts#resolvedRunContract #2719478 The declaration is idlekit.resolved-run-configuration. This test reads that property.
 * @evidence ./runConfiguration.ts#sessionCaseSeed Reads the repro label. The runs use seed 1.
 * @evidenceReview ./runConfiguration.ts#sessionCaseSeed #47c0b85 The declaration is 0x7107. The runs do not draw from that label.
 */
export function keepsResolvedRunConfiguration(): void {
  expect(resolvedRunContract).toBe("idlekit.resolved-run-configuration");
  expect(sessionCaseSeed).toBe(0x7107);

  const loaded = registries();
  const input = scenario();
  const prepared = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    fast: true,
    seed: 1,
    pluginDigest: { "/tmp/a/plugin.ts": "abc", "/tmp/b/plugin.ts": "def" },
  });
  const standalone = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    fast: true,
    seed: 1,
    pluginDigest: { "/var/other/plugin.ts": "def", "/var/other/copy.ts": "abc" },
  });
  expect(prepared.hash).toBe(standalone.hash);
  expect(prepared.definition).not.toBe(prepared.open("simulate", "evaluate:simulate").scenario);

  const simulate = prepared.open("simulate", "evaluate:simulate");
  const experience = prepared.open("experience", "evaluate:experience");
  expect(simulate.plan.stage.applies).toEqual({ strategy: true, step: true, fast: true, session: false });
  expect(experience.plan.stage.applies).toEqual({ strategy: true, step: false, fast: false, session: true });
  expect(simulate.scenario.ctx.stepSec).toBe(5);
  expect(simulate.scenario.run.stepSec).toBe(5);
  expect(experience.scenario.ctx.stepSec).toBe(1);
  expect(experience.scenario.run.stepSec).toBe(1);
  expect(simulate.scenario.strategy).not.toBe(experience.scenario.strategy);

  const simulateRun = runScenario(simulate.scenario);
  const experienceRun = simulateSessionPattern({
    scenario: experience.scenario,
    pattern: { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 0, durationSec: 1 }] },
    seed: 1,
  });
  expect(simulateRun.end.vars).toEqual({ bought: 1 });
  expect(experienceRun.end.vars).toEqual({ bought: 1 });

  const alone = standalone.open("simulate", "standalone:simulate");
  const aloneRun = runScenario(alone.scenario);
  expect(aloneRun.end.vars).toEqual(simulateRun.end.vars);
  expect(aloneRun.end.t).toBe(simulateRun.end.t);

  const consistent = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    seed: 1,
    consistentOverrides: true,
  });
  expect(consistent.open("experience", "consistent").scenario.ctx.stepSec).toBe(5);

  const seen: number[] = [];
  const plannerModel: ModelFactory = {
    id: "m",
    version: 1,
    create: () => ({
      id: "m",
      version: 1,
      income: (ctx: any) => {
        if (ctx.stepSec !== undefined) seen.push(ctx.stepSec);
        return { unit: ctx.unit, amount: ctx.E.from(0) };
      },
      netWorth: (_ctx: any, state: any) => state.wallet.money,
      actions: () => [],
    }),
  };
  const plannerPrepared = prepareResolvedRun({
    scenario: { ...input, strategy: { id: "planner" } },
    modelRegistry: createModelRegistry([plannerModel]),
    strategyRegistry: loaded.strategyRegistry,
    strategyOverride: "planner",
    stepSec: 5,
    seed: 1,
  });
  const plannerScenario = plannerPrepared.open("simulate", "planner").scenario;
  plannerScenario.strategy?.decide(plannerScenario.ctx, plannerScenario.model, plannerScenario.initial);
  expect(plannerScenario.ctx.stepSec).toBe(5);
  expect(seen.some((step) => step === 5)).toBeTrue();

  const metadataEngine = resolveEffectiveEngine({
    scenarioEngine: { name: "breakInfinity", version: "9" },
  });
  expect(metadataEngine.effectiveId).toBe("number");
  expect(metadataEngine.scenarioEngineRole).toBe("metadata");
  expect(metadataEngine.engine.zero()).toBe(0);

  const big = resolveEffectiveEngine({ requested: "breakInfinity" });
  const huge = big.engine.from("1e400");
  expect(typeof huge).not.toBe("number");
  expect(big.engine.isFinite(huge)).toBeTrue();
  expect(Number.isFinite(Number("1e400"))).toBeFalse();
  expect(() => resolveEffectiveEngine({ requested: "breakEternity" })).toThrow(BREAK_ETERNITY_EXPERIMENTAL_MESSAGE);

  let created = 0;
  const custom = resolveEffectiveEngine({
    requested: "custom.fixed",
    customEngines: [
      {
        id: "custom.fixed",
        trusted: true,
        create: () => {
          created += 1;
          return createNumberEngine();
        },
      },
    ],
  });
  expect(custom.effectiveId).toBe("custom.fixed");
  expect(created).toBe(1);
  expect(() => resolveEffectiveEngine({ requested: "plugin.hidden" })).toThrow(/Untrusted engines are not loaded/);
  expect(() =>
    prepareResolvedRun({
      scenario: input,
      ...loaded,
      strategyOverride: "plugin.not-loaded",
      seed: 1,
    }),
  ).toThrow(/Unknown strategy: plugin.not-loaded/);

  const digest = {
    scenario: input,
    engineId: "number",
    strategyId: "custom.once",
    strategyParams: customStrategy.defaultParams,
    paramsMode: "legacy-raw" as const,
    stepSec: 1,
    seed: 1,
    pluginDigests: pluginDigestValues({ "/tmp/one/plugin.ts": "abc" }),
    fast: false,
  };
  expect(effectiveRunHash({ ...digest, cwd: "/tmp/one", scenarioPath: "/tmp/one/scenario.json", generatedAt: "t0" })).toBe(
    effectiveRunHash({ ...digest, cwd: "/tmp/two", scenarioPath: "/tmp/two/scenario.json", generatedAt: "t1" }),
  );
  expect(effectiveRunHash({ ...digest, stepSec: 2 })).not.toBe(effectiveRunHash(digest));
  expect(effectiveRunHash({ ...digest, strategyId: "greedy" })).not.toBe(effectiveRunHash(digest));

  const suffixScenario: ScenarioV1 = {
    ...input,
    clock: { stepSec: 1, durationSec: 1, untilExpr: "money >= 1aa" },
  };
  const suffixNumber = compileScenario({
    E: createNumberEngine(),
    scenario: suffixScenario,
    registry: loaded.modelRegistry,
    strategyRegistry: loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  const atThousand = {
    ...suffixNumber.initial,
    wallet: {
      ...suffixNumber.initial.wallet,
      money: { ...suffixNumber.initial.wallet.money, amount: 1000 },
    },
  };
  expect(suffixNumber.run.until?.(suffixNumber.initial)).toBeFalse();
  expect(suffixNumber.run.until?.(atThousand)).toBeTrue();

  const bigEngine = createBreakInfinityEngine();
  const wide = compileScenario({
    E: bigEngine,
    scenario: {
      ...suffixScenario,
      clock: { stepSec: 1, durationSec: 1, untilExpr: "money >= 1e400" },
    },
    registry: loaded.modelRegistry,
    strategyRegistry: loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  const wideAmount = bigEngine.from("1e400");
  expect(typeof wideAmount).not.toBe("number");
  expect(
    wide.run.until?.({
      ...wide.initial,
      wallet: { ...wide.initial.wallet, money: { ...wide.initial.wallet.money, amount: wideAmount } },
    }),
  ).toBeTrue();
}

describe("PR-07 resolved run", () => {
  it("keeps resolved run configuration", keepsResolvedRunConfiguration);
});
