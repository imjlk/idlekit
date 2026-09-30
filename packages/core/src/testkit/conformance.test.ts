import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import { etaAnalytic, etaSimulate } from "../sim/analysis/eta";
import type { Action, CompiledScenario, Model, SimState } from "../sim/types";
import type { Strategy } from "../sim/strategy/types";
import { compareAmounts } from "./compareAmounts";
import { conformanceGeneratorVersion } from "./conformance";
import {
  checkBulk,
  checkDurationBoundary,
  checkJsonRoundTrip,
  checkNonNegative,
  checkObserver,
  checkReplay,
  checkResume,
  checkResumeFromJson,
  checkRetention,
  checkSnapshots,
  checkTimedSources,
  checkTrialOrder,
  conformanceCaseCount,
  demonstrateShrinkGap,
  economyAfter,
  expectProperty,
  gameSeedForCase,
  rejectNonPositiveStep,
  replayShrinkReport,
  type RelationCheck,
} from "./conformanceRun";

type UnitCode = "COIN";
type Vars = { buys: number };

const fixturePath = join(import.meta.dir, "../../../../fixtures/conformance/shrink-gap.json");

function expectApplicable(result: RelationCheck): void {
  if (!result.ok || !result.applicable) throw new Error(result.summary);
}

function state(engine: Engine<number>, amount: number, buys = 0): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: engine.zero() },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: engine.zero(), multiplier: engine.from(1) },
    vars: { buys },
  };
}

function constantScenario(args: {
  rate: number;
  durationSec: number;
  stepSec: number;
  seed?: number;
}): CompiledScenario<number, UnitCode, Vars> {
  const engine = createNumberEngine();
  const unit = { code: "COIN" as const };
  const model: Model<number, UnitCode, Vars> = {
    id: "constant-income",
    version: 1,
    income: () => ({ unit, amount: args.rate }),
    actions: () => [],
    analytic: () => ({ incomeKind: "constant" }),
  };
  return {
    ctx: {
      E: engine,
      unit,
      tickPolicy: { mode: "drop" },
      seed: args.seed,
      stepSec: args.stepSec,
    },
    model,
    initial: state(engine, 0),
    run: { stepSec: args.stepSec, durationSec: args.durationSec },
  };
}

function thresholdScenario(stepSec: number): CompiledScenario<number, UnitCode, Vars> {
  const engine = createNumberEngine();
  const unit = { code: "COIN" as const };
  const buy: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => ({ unit, amount: 15 }),
    apply: (_ctx, current) => ({
      ...current,
      vars: { buys: current.vars.buys + 1 },
    }),
  };
  const model: Model<number, UnitCode, Vars> = {
    id: "threshold-buy",
    version: 1,
    income: () => ({ unit, amount: 10 }),
    actions: () => [buy],
  };
  const strategy: Strategy<number, UnitCode, Vars> = {
    id: "always-buy",
    decide: () => [{ action: buy }],
  };
  return {
    ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, stepSec },
    model,
    initial: state(engine, 0),
    strategy,
    run: { stepSec, durationSec: 2 },
  };
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Replays the saved shrink-gap counterexample and one constant-income run.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: the gap shrinks to 1 and the constant-income replay matches.
 * @evidence ./conformance.ts#conformanceGeneratorVersion Reads generator version 1 from the shrink report and from this export.
 * @evidenceReview ./conformance.ts#conformanceGeneratorVersion #80e01c8 The declaration is the number 1. The shrink report stores that same generatorVersion.
 */
export function replaysConstantIncomeAndShrinksGap(): void {
  const report = demonstrateShrinkGap();
  const saved = JSON.parse(readFileSync(fixturePath, "utf8")) as typeof report;
  expect(saved).toEqual(report);
  expect(report.value).toBe(1);
  expect(report.generatorVersion).toBe(conformanceGeneratorVersion);
  expect(report.gameSeed).toBeNull();
  expect(report.testSeed).toBe(0xd101);
  const replay = replayShrinkReport(saved);
  expect(replay.failed).toBe(true);
  expect(replay.pathOk).toBe(true);
  expect(replay.shrunk).toBe(1);

  const scenario = constantScenario({ rate: 3, durationSec: 4, stepSec: 1, seed: 11 });
  expectApplicable(checkReplay(scenario));
  const gameSeed = gameSeedForCase(0x51ed, 0);
  expect(gameSeed).not.toBe(0x51ed);
  expect(Number.isInteger(gameSeed)).toBe(true);
}

describe("DX-01 conformance harness", () => {
  it("replays a constant-income run and shrinks the gap predicate", replaysConstantIncomeAndShrinksGap);

  it("replays constant income across the fixed seed corpus", () => {
    expectProperty({
      predicateId: "constant-replay",
      testSeed: 0xc0ffee,
      cases: conformanceCaseCount(),
      generate: (index, rng) => ({
        rate: rng.int(1, 5),
        durationSec: rng.int(2, 8),
        stepSec: 1,
        seed: gameSeedForCase(0xc0ffee, index),
      }),
      shrink: (value) => {
        const smaller = [];
        if (value.durationSec > 2) smaller.push({ ...value, durationSec: value.durationSec - 1 });
        if (value.rate > 1) smaller.push({ ...value, rate: value.rate - 1 });
        return smaller;
      },
      predicate: (value) =>
        checkReplay(constantScenario(value)).ok && checkJsonRoundTrip(constantScenario(value)).ok,
      describeCase: (value) => ({
        gameSeed: value.seed,
        engineId: "number",
        modelId: "constant-income",
        strategyId: null,
        tickSchedule: { stepSec: value.stepSec, durationSec: value.durationSec },
      }),
    });
  });
});

describe("PR-01 bulk equivalence", () => {
  it("checks bulk equality only when the fixture declares it", () => {
    const linear = (count: number, times: number) => JSON.stringify({ count: count + times, bonus: 0 });
    const declared = checkBulk(true, linear(0, 3), linear(0, 3));
    expectApplicable(declared);

    let stepped = { count: 0, bonus: 0 };
    for (let index = 0; index < 2; index += 1) {
      const count = stepped.count + 1;
      stepped = { count, bonus: count === 2 ? stepped.bonus + 10 : stepped.bonus };
    }
    const bulk = JSON.stringify({ count: 2, bonus: 0 });
    const repeated = JSON.stringify(stepped);
    const undeclared = checkBulk(false, repeated, bulk);
    expect(undeclared.applicable).toBe(false);
    expect(undeclared.ok).toBe(true);
    expect(repeated).not.toBe(bulk);
  });
});

describe("PR-02 time boundaries", () => {
  it("stops on a positive tick grid and refuses a non-positive step", () => {
    const scenario = constantScenario({ rate: 2, durationSec: 4, stepSec: 1 });
    expectApplicable(checkDurationBoundary(scenario));
    const refused = rejectNonPositiveStep(0);
    expect(refused.ok).toBe(false);
    expect(refused.applicable).toBe(true);
    const offGrid = checkResume(scenario, 1.5);
    expect(offGrid.applicable).toBe(false);

    const fractional = constantScenario({ rate: 2, durationSec: 0.3, stepSec: 0.1 });
    expectApplicable(checkDurationBoundary(fractional));
    expectApplicable(checkResume(fractional, 0.2));
    const earlyStop = checkDurationBoundary({
      ...scenario,
      run: { ...scenario.run, until: (current) => current.t >= 3 },
    });
    expect(earlyStop.applicable).toBe(false);
    expect(earlyStop.ok).toBe(true);
  });

  it("treats step 1 and 0.5 as equal only for constant income", () => {
    const coarse = economyAfter(constantScenario({ rate: 4, durationSec: 4, stepSec: 1 }));
    const fine = economyAfter(constantScenario({ rate: 4, durationSec: 4, stepSec: 0.5 }));
    expectApplicable(checkSnapshots(coarse, fine, "same"));

    const coarseBuy = economyAfter(thresholdScenario(1));
    const fineBuy = economyAfter(thresholdScenario(0.5));
    expectApplicable(checkSnapshots(coarseBuy, fineBuy, "different"));
  });
});

describe("PR-03 resume isolation", () => {
  it("resumes on the same tick grid from memory and from JSON", () => {
    const scenario = constantScenario({ rate: 5, durationSec: 6, stepSec: 1, seed: 19 });
    expectApplicable(checkResume(scenario, 2));
    expectApplicable(checkResumeFromJson(scenario, 2));
    expectApplicable(checkJsonRoundTrip(scenario));
    const gameA = gameSeedForCase(0x51ed, 1);
    const gameB = gameSeedForCase(0x51ed, 2);
    expectApplicable(
      checkTrialOrder(
        (gameSeed) => economyAfter(constantScenario({ rate: 2, durationSec: 3, stepSec: 1, seed: gameSeed })),
        [gameA, gameB],
      ),
    );
  });
});

describe("PR-05 observation retention", () => {
  it("keeps the economy when retention or a recording observer changes", () => {
    const scenario = constantScenario({ rate: 4, durationSec: 3, stepSec: 1, seed: 23 });
    const retention = checkRetention(scenario);
    expectApplicable(retention);
    expect(retention.summary).toContain("retained");
    expect(retention.summary).toContain("dropped 0");
    const observer = checkObserver(scenario);
    expectApplicable(observer);
    expect(observer.summary).toContain("observed batches");
  });

  it("bans a negative balance only when debt is disallowed", () => {
    const engine = createNumberEngine();
    const unit = { code: "COIN" as const };
    const buy: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit, amount: 5 }),
      apply: (_ctx, current) => current,
    };
    const blocked: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, payment: { onInsufficientFunds: "skip" } },
      model: { id: "skip-payment", version: 1, income: () => ({ unit, amount: 0 }), actions: () => [buy] },
      initial: state(engine, 1),
      strategy: { id: "always-buy", decide: () => [{ action: buy }] },
      run: { stepSec: 1, durationSec: 1 },
    };
    const blockedEnd = economyAfter(blocked);
    expect(blockedEnd).toContain('"amount":"1"');
    expectApplicable(checkNonNegative(false, false));

    const debt: Action<number, UnitCode, Vars> = {
      id: "debt",
      kind: "custom",
      canApply: () => true,
      cost: () => null,
      apply: (ctx, current) => ({
        ...current,
        wallet: {
          ...current.wallet,
          money: { ...current.wallet.money, amount: ctx.E.sub(current.wallet.money.amount, ctx.E.from(5)) },
        },
      }),
    };
    const allowed: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E: engine, unit, tickPolicy: { mode: "drop" } },
      model: { id: "allows-debt", version: 1, income: () => ({ unit, amount: 0 }), actions: () => [debt] },
      initial: state(engine, 1),
      strategy: { id: "take-debt", decide: () => [{ action: debt }] },
      run: { stepSec: 1, durationSec: 1 },
    };
    const after = economyAfter(allowed);
    expect(after).toContain('"amount":"-4"');
    const skipped = checkNonNegative(true, true);
    expect(skipped.applicable).toBe(false);
  });
});

describe("analysis source labels", () => {
  it("keeps formula seconds apart from executed eta results", () => {
    const scenario = constantScenario({ rate: 1, durationSec: 10, stepSec: 1 });
    const simulate = etaSimulate({
      scenario,
      target: { kind: "money", value: "3" },
      maxDurationSec: 10,
    });
    const analytic = etaAnalytic({
      scenario,
      target: { kind: "money", value: "3" },
    });
    const formulaSeconds = 3;
    const result = checkTimedSources({
      formulaSeconds,
      simulate: { mode: simulate.mode, seconds: simulate.seconds },
      analytic: { mode: analytic.mode, seconds: analytic.seconds },
    });
    expectApplicable(result);
    expect(result.summary).toContain("formula 3");
    expect(result.summary).toContain("executed simulate 3");
    expect(result.summary).toContain("executed analytic 3");
    expect(simulate.mode).toBe("simulate");
    expect(analytic.mode).toBe("analytic");
  });
});

describe("engine differential", () => {
  it("matches a safe constant run and refuses number Infinity collapse", () => {
    const numberEngine = createNumberEngine();
    const bigEngine = createBreakInfinityEngine();
    const scenario = constantScenario({ rate: 6, durationSec: 4, stepSec: 1 });
    expect(economyAfter(scenario)).toContain('"amount":"24"');
    const comparison = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(24) },
      { engineId: "break-infinity", engine: bigEngine, amount: bigEngine.from(24) },
    );
    expect(comparison.status).toBe("equal");
    const collapsed = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from("1e400") },
      { engineId: "break-infinity", engine: bigEngine, amount: bigEngine.from("1e400") },
    );
    expect(numberEngine.isFinite(numberEngine.from("1e400"))).toBe(false);
    expect(bigEngine.isFinite(bigEngine.from("1e400"))).toBe(true);
    expect(collapsed.status).toBe("refused-number-collapse");
    expect(collapsed.left).not.toBe(collapsed.right);

    const nearZero = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(0) },
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(1e-13) },
    );
    expect(nearZero.status).toBe("different");
    const opposite = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(1e-13) },
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(-1e-13) },
    );
    expect(opposite.status).toBe("different");
  });
});
