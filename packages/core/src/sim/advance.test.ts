import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { createNumberEngine } from "../engine/breakInfinity";
import { advanceResult } from "./analysis/registry";
import {
  advanceAlgorithmVersion,
  advanceCapabilityOf,
  advanceExactMatch,
  advanceFactsKept,
  advanceGuardedFallback,
  advanceJsonSchema,
  advanceMeasuredBench,
  advancePolicyThreshold,
  advanceSchemaId,
  advanceStochasticSeed,
  applyExactIncome,
  consumeExactChunk,
  createAdvanceLedger,
  finishAdvanceReport,
  measureAdvanceRow,
  refusalForAdvance,
  validateAdvanceReport,
} from "./advance";
import { applyOfflineSeconds } from "./offline";
import { runScenario } from "./simulator";
import { exactAmountSign } from "./step";
import type { CompiledScenario, Model, SimState } from "./types";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../examples/analysis/advance-constant.json", import.meta.url), "utf8"),
) as {
  seed: string;
  incomePerSec: number;
  stepSec: number;
  durationSec: number;
  goalAmount: number;
  chunks: number[];
  bench: { label: string; horizonSec: number; stepSec: number }[];
};

type UnitCode = "COIN";
type Vars = { owned: number };

function state(amount = 0): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned: 0 },
  };
}

function scenario(args: {
  income?: number | ((t: number) => number);
  durationSec?: number;
  stepSec?: number;
  chunkSec?: number;
  tolerance?: string;
  advance?: boolean;
  seed?: number;
  maxLogGap?: number;
  mode?: "drop" | "accumulate";
  clocks?: boolean;
  actions?: boolean;
  evolve?: boolean;
  milestones?: boolean;
  softcap?: boolean;
  analytic?: boolean;
  incomeKind?: "constant" | "linear";
  fast?: boolean;
  until?: boolean;
  strategy?: boolean;
}): CompiledScenario<number, UnitCode, Vars> {
  const income = args.income ?? fixture.incomePerSec;
  const model: Model<number, UnitCode, Vars> = {
    id: "constant-income",
    version: 1,
    income: (ctx, current) => ({
      unit: ctx.unit,
      amount: typeof income === "number" ? income : income(current.t),
    }),
    actions: () =>
      args.actions
        ? [
            {
              id: "buy",
              kind: "buy",
              canApply: () => true,
              cost: () => ({ unit: { code: "COIN" }, amount: 1 }),
              apply: (_ctx, current) => current,
            },
          ]
        : [],
    ...(args.evolve ? { evolve: (_ctx, current) => current } : {}),
    ...(args.milestones ? { milestones: () => ["tick"] } : {}),
    ...(args.analytic === false
      ? {}
      : {
          analytic: () => ({
            incomeKind: args.incomeKind ?? "constant",
            ...(args.softcap ? { softcap: { kind: "log" as const, startsAt: { unit: { code: "COIN" as const }, amount: 5 } } } : {}),
          }),
        }),
  };
  const goal = fixture.goalAmount;
  return {
    ctx: {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: args.mode ?? "drop", ...(args.maxLogGap !== undefined ? { maxLogGap: args.maxLogGap } : {}) },
      ...(args.seed !== undefined ? { seed: args.seed } : {}),
      ...(args.clocks ? { clocks: { wallT: 0, wallEndT: 60, rewardT: 0, activeT: 0 } } : {}),
    },
    model,
    initial: state(),
    ...(args.strategy ? { strategy: { id: "script", decide: () => [] } } : {}),
    run: {
      stepSec: args.stepSec ?? fixture.stepSec,
      durationSec: args.durationSec ?? fixture.durationSec,
      ...(args.until === false ? {} : { until: (current: SimState<number, UnitCode, Vars>) => current.wallet.money.amount >= goal }),
      goals: [{ id: "wallet", met: (current) => current.wallet.money.amount >= goal }],
      ...(args.fast ? { fast: { enabled: true, disableMoneyEvents: true } } : {}),
      ...(args.advance === false
        ? {}
        : {
            advance: {
              enabled: true,
              ...(args.chunkSec !== undefined ? { chunkSec: args.chunkSec } : {}),
              ...(args.tolerance !== undefined ? { tolerance: args.tolerance } : {}),
            },
          }),
    },
  };
}

function walletOf(amount: number): number {
  return amount;
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match Constant income matches the reference run.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match #4a3881f Re-read the section, then ran this function: wallet, goal time, and counters match for both chunk sizes, and a chunk takes whole reference steps.
 * @evidence ./advance.ts#advanceExactMatch Reads the exact-match marker.
 * @evidenceReview ./advance.ts#advanceExactMatch #1e96b8b The declaration is constant-income-matches-reference.
 * @evidence ./advance.ts#consumeExactChunk Takes whole reference steps from nextBoundary.
 * @evidenceReview ./advance.ts#consumeExactChunk #636ec60 A chunk below one step takes one whole step, a 2.5-step chunk takes two, and a near-epsilon horizon tail is not ticked.
 * @evidence ./advance.ts#applyExactIncome Adds the scaled income as the tick policy applies it.
 * @evidenceReview ./advance.ts#applyExactIncome #63aaf66 Drop adds the scaled income, accumulate adds the bucket too, the bucket ends empty, and max money follows.
 * @evidence ./step.ts#exactAmountSign Gives the exact sign the fixed-step reward test uses.
 * @evidenceReview ./step.ts#exactAmountSign #c8eab59 Positive, zero, and negative amounts give 1, 0, and -1.
 * @evidence ./simulator.ts#runScenario Runs the scenario with run.advance omitted and enabled.
 * @evidenceReview ./simulator.ts#runScenario #7ee1218 Exact chunks record one observation sample per reference step on the summed clock, and the wallet, goals, stats, and reward gap equal fixed-step.
 * @evidence ./offline.ts#applyOfflineSeconds Runs the offline credit with run.advance omitted and enabled.
 * @evidenceReview ./offline.ts#applyOfflineSeconds #ca66240 Without a strategy the offline credit takes exact chunks, and its wallet and stats equal fixed-step.
 */
export function matchesReferenceWalletAndGoal(): void {
  expect(fixture.seed).toBe("16");
  expect(advanceExactMatch).toBe("constant-income-matches-reference");
  expect(advanceSchemaId()).toBe("https://idlekit.dev/schemas/advance.v1.schema.json");
  expect(advanceAlgorithmVersion()).toBe("guarded-advance-1");
  expect(advanceJsonSchema().version).toBe("3.1");
  const reference = runScenario(scenario({ advance: false }));
  for (const chunkSec of fixture.chunks) {
    const exact = runScenario(scenario({ chunkSec }));
    expect(validateAdvanceReport(exact.advance).success).toBe(true);
    expect(exact.advance?.status).toBe("exact");
    expect(exact.advance?.observation).toBe("equivalent");
    expect(exact.advance?.seedSchedule).toBe("unchanged");
    expect(exact.advance?.fallbackSteps).toBe(0);
    expect(walletOf(exact.end.wallet.money.amount)).toBe(reference.end.wallet.money.amount);
    expect(exact.end.vars).toEqual(reference.end.vars);
    expect(exact.end.t).toBe(reference.end.t);
    expect(exact.observation?.goals).toEqual(reference.observation?.goals);
    expect(exact.stats).toEqual(reference.stats);
    expect(exact.observation?.rewardGap).toEqual(reference.observation?.rewardGap);
  }
  const offline = applyOfflineSeconds({
    scenario: scenario({ advance: false, until: false, durationSec: 4 }),
    seconds: 4,
    options: { useStrategy: false },
  });
  const offlineExact = applyOfflineSeconds({
    scenario: scenario({ chunkSec: 4, until: false, durationSec: 4 }),
    seconds: 4,
    options: { useStrategy: false },
  });
  expect(offlineExact.advance?.status).toBe("exact");
  expect(offlineExact.end.wallet.money.amount).toBe(offline.end.wallet.money.amount);
  expect(offlineExact.stats).toEqual(offline.stats);
  // Whole reference steps only: a chunk below one step is one step, and 2.5 steps is two.
  const compiled = scenario({ until: false });
  const chunk = (chunkSec: number, durationSec = fixture.durationSec) =>
    consumeExactChunk({
      ctx: compiled.ctx,
      model: compiled.model,
      state: compiled.initial,
      firstDt: 1,
      stepSec: 1,
      chunkSec,
      elapsedSec: 0,
      steps: 0,
      durationSec,
      requested: "exact",
    });
  const half = chunk(0.5);
  expect(half.ok && half.samples.map((sample) => sample.dt)).toEqual([1]);
  const twoAndHalf = chunk(2.5);
  expect(twoAndHalf.ok && twoAndHalf.samples.map((sample) => sample.dt)).toEqual([1, 1]);
  // A tail inside the horizon epsilon is not a tick, as nextBoundary decides for fixed-step.
  const tail = chunk(10, 2 + 1e-13);
  expect(tail.ok && tail.samples.length).toBe(2);
  const accumulated = applyExactIncome(createNumberEngine(), { ...state(1), wallet: { money: { unit: { code: "COIN" }, amount: 1 }, bucket: 0.5 } }, 2, 1, "accumulate");
  expect(accumulated.wallet.money.amount).toBe(3.5);
  expect(accumulated.wallet.bucket).toBe(0);
  expect(accumulated.maxMoneyEver.amount).toBe(3.5);
  expect(applyExactIncome(createNumberEngine(), state(1), 2, 1).wallet.money.amount).toBe(3);
  const E = createNumberEngine();
  expect([exactAmountSign(E, 2), exactAmountSign(E, 0), exactAmountSign(E, -2)]).toEqual([1, 0, -1]);
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback Unclear boundaries stay on fixed-step.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #2aa29e1 Re-read the section, then ran this function: purchase, evolve, capacity, session clocks, an emitter, and a non-empty bucket fall back.
 * @evidence ./advance.ts#advanceGuardedFallback Reads the fallback marker.
 * @evidenceReview ./advance.ts#advanceGuardedFallback #8f900a5 The declaration is unclear-boundary-uses-fixed-step.
 * @evidence ./advance.ts#validateAdvanceReport Reads the published validator.
 * @evidenceReview ./advance.ts#validateAdvanceReport #0f09fd6 The validator is createValidate of AdvanceReportV1, built on first call, and accepts each fallback report.
 * @evidence ./advance.ts#advanceJsonSchema Reads the generated schema marker.
 * @evidenceReview ./advance.ts#advanceJsonSchema #0d7e513 The memoized schema version is 3.1.
 * @evidence ./advance.ts#advanceSchemaId Reads the schema id.
 * @evidenceReview ./advance.ts#advanceSchemaId #6afa8c9 The id is the advance v1 schema URL.
 * @evidence ./advance.ts#advanceAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ./advance.ts#advanceAlgorithmVersion #9fd45c6 The version is guarded-advance-1.
 * @evidence ./advance.ts#refusalForAdvance Names the boundary that keeps a step on fixed-step.
 * @evidenceReview ./advance.ts#refusalForAdvance #3011a0e Purchase, evolve, milestone, soft cap, session clock, strategy, emit, a non-empty bucket, and approximation each refuse.
 * @evidence ./advance.ts#advanceCapabilityOf Reads the capability the report names.
 * @evidenceReview ./advance.ts#advanceCapabilityOf #1709430 No hint is unsupported, a null hint is unknown, constant is statically known, and linear is unsupported.
 * @evidence ./advance.ts#createAdvanceLedger Starts the exact and fallback counters.
 * @evidenceReview ./advance.ts#createAdvanceLedger #9d03c28 A new ledger keeps the request and tolerance and counts nothing.
 * @evidence ./advance.ts#finishAdvanceReport Turns the ledger into the report.
 * @evidenceReview ./advance.ts#finishAdvanceReport #fa2cbf3 A ledger with a fallback step is fallback with its first reason, and an approximation is degraded with its tolerance.
 */
export function fallsBackOnUnclearBoundaries(): void {
  expect(advanceGuardedFallback).toBe("unclear-boundary-uses-fixed-step");
  expect(advanceSchemaId()).toBe("https://idlekit.dev/schemas/advance.v1.schema.json");
  expect(advanceAlgorithmVersion()).toBe("guarded-advance-1");
  expect(advanceJsonSchema().version).toBe("3.1");
  const cases = [
    scenario({ actions: true }),
    scenario({ evolve: true }),
    scenario({ milestones: true }),
    scenario({ softcap: true }),
    scenario({ clocks: true }),
    scenario({ strategy: true }),
    scenario({ analytic: false }),
    scenario({ incomeKind: "linear" }),
    scenario({ tolerance: "0.01" }),
  ];
  for (const compiled of cases) {
    const reference = runScenario({ ...compiled, run: { ...compiled.run, advance: undefined } });
    const guarded = runScenario(compiled);
    expect(guarded.advance?.status).toBe("fallback");
    expect(guarded.advance && validateAdvanceReport(guarded.advance).success).toBe(true);
    expect(guarded.advance?.exactSteps).toBe(0);
    expect(guarded.end.wallet.money.amount).toBe(reference.end.wallet.money.amount);
    expect(guarded.end.t).toBe(reference.end.t);
    expect(guarded.observation?.goals).toEqual(reference.observation?.goals);
    expect(guarded.stats).toEqual(reference.stats);
  }
  // A context emitter and a non-empty bucket also stay on fixed-step.
  const emitting = scenario({});
  const withEmit = { ...emitting, ctx: { ...emitting.ctx, emit: () => undefined } };
  const emitted = runScenario(withEmit);
  expect(emitted.advance?.status).toBe("fallback");
  expect(emitted.advance?.reason).toBe("event emitter receives each tick");
  const bucketed = scenario({ mode: "accumulate" });
  const withBucket = { ...bucketed, initial: { ...bucketed.initial, wallet: { ...bucketed.initial.wallet, bucket: 0.5 } } };
  const bucketRun = runScenario(withBucket);
  const bucketReference = runScenario({ ...withBucket, run: { ...withBucket.run, advance: undefined } });
  expect(bucketRun.advance?.reason).toBe("money bucket is not empty");
  expect(bucketRun.end.wallet.money.amount).toBe(bucketReference.end.wallet.money.amount);
  expect(bucketRun.stats).toEqual(bucketReference.stats);
  const refusalArgs = (compiled: ReturnType<typeof scenario>) => ({
    ctx: compiled.ctx,
    model: compiled.model,
    state: compiled.initial,
    dt: 1,
    requested: "exact" as const,
  });
  expect(refusalForAdvance(refusalArgs(scenario({})))).toBeNull();
  expect(refusalForAdvance({ ...refusalArgs(scenario({})), requested: "approximation" })).toBe("approximation is not applied");
  expect(refusalForAdvance(refusalArgs(scenario({ evolve: true })))).toBe("evolve is not in the exact interval");
  const engine = createNumberEngine();
  expect(advanceCapabilityOf(scenario({ analytic: false }).model, scenario({}).ctx, state())).toBe("unsupported");
  expect(advanceCapabilityOf({ ...scenario({}).model, analytic: () => null }, scenario({}).ctx, state())).toBe("unknown");
  expect(advanceCapabilityOf(scenario({}).model, { ...scenario({}).ctx, E: engine }, state())).toBe("statically-known");
  expect(advanceCapabilityOf(scenario({ incomeKind: "linear" }).model, scenario({}).ctx, state())).toBe("unsupported");
  const exactRequest = "exact" as const;
  const ledger = createAdvanceLedger(exactRequest, null);
  expect(ledger).toEqual({ requested: "exact", tolerance: null, exactSteps: 0, fallbackSteps: 0, chunks: 0, reasons: [] });
  ledger.fallbackSteps = 1;
  ledger.reasons.push("evolve is not in the exact interval", "evolve is not in the exact interval");
  const finished = finishAdvanceReport(ledger, "statically-known");
  expect(finished.status).toBe("fallback");
  expect(finished.reason).toBe("evolve is not in the exact interval");
  const approximationRequest = "approximation" as const;
  const approximate = finishAdvanceReport(createAdvanceLedger(approximationRequest, "0.5"), "unknown");
  expect([approximate.status, approximate.observation, approximate.tolerance]).toEqual(["fallback", "degraded", "0.5"]);
  const approx = runScenario(scenario({ tolerance: "0.01" }));
  expect(approx.advance?.requested).toBe("approximation");
  expect(approx.advance?.observation).toBe("degraded");
  expect(approx.advance?.tolerance).toBe("0.01");
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-policy-boundary A threshold refuses the chunk.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-policy-boundary #fe9aa0a Re-read the section, then ran this function: drop and accumulate thresholds stay on fixed-step.
 * @evidence ./advance.ts#advancePolicyThreshold Reads the threshold marker.
 * @evidenceReview ./advance.ts#advancePolicyThreshold #73b50f7 The declaration is threshold-is-not-composed.
 */
export function refusesPolicyThresholds(): void {
  expect(advancePolicyThreshold).toBe("threshold-is-not-composed");
  for (const mode of ["drop", "accumulate"] as const) {
    const compiled = scenario({ mode, maxLogGap: 3, chunkSec: 8 });
    const reference = runScenario({ ...compiled, run: { ...compiled.run, advance: undefined } });
    const guarded = runScenario(compiled);
    expect(guarded.advance?.status).toBe("fallback");
    expect(guarded.advance?.reason).toContain("threshold");
    expect(guarded.end.wallet.money.amount).toBe(reference.end.wallet.money.amount);
    expect(guarded.stats).toEqual(reference.stats);
  }
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-stochastic A seed does not take the analytic chunk.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-stochastic #63e1126 Re-read the section, then ran this function: exactSteps stays 0.
 * @evidence ./advance.ts#advanceStochasticSeed Reads the stochastic marker.
 * @evidenceReview ./advance.ts#advanceStochasticSeed #9bf3c65 The declaration is seed-without-capability-stays-fixed.
 */
export function keepsSeededModelsOnFixedStep(): void {
  expect(advanceStochasticSeed).toBe("seed-without-capability-stays-fixed");
  const compiled = scenario({ seed: Number(fixture.seed), chunkSec: 8 });
  const reference = runScenario({ ...compiled, run: { ...compiled.run, advance: undefined } });
  const guarded = runScenario(compiled);
  expect(guarded.advance?.status).toBe("fallback");
  expect(guarded.advance?.exactSteps).toBe(0);
  expect(guarded.advance?.reason).toContain("seed");
  expect(guarded.advance?.seedSchedule).toBe("unchanged");
  expect(guarded.end.wallet.money.amount).toBe(reference.end.wallet.money.amount);
  expect(guarded.stats).toEqual(reference.stats);
  const known = advanceResult("statically-known");
  expect(known.status).toBe("insufficient-data");
  expect(known.reason).toBe("advance observations were not supplied");
  expect(advanceResult("unsupported").status).toBe("unsupported");
  expect(JSON.stringify(advanceResult("unsupported"))).not.toContain("stable");
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-observation-facts Fast omission keeps the money counters.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-observation-facts #7eaece6 Re-read the section, then ran this function: applied counters match and missing events are not zeros.
 * @evidence ./advance.ts#advanceFactsKept Reads the facts marker.
 * @evidenceReview ./advance.ts#advanceFactsKept #5cbae98 The declaration is fast-events-keep-observation-facts.
 */
export function keepsFactsWhenEventsAreOmitted(): void {
  expect(advanceFactsKept).toBe("fast-events-keep-observation-facts");
  const reference = runScenario(scenario({ advance: false, fast: true }));
  const exact = runScenario(scenario({ chunkSec: 8, fast: true }));
  expect(exact.advance?.status).toBe("exact");
  expect(exact.stats).toEqual(reference.stats);
  expect(exact.observation?.money).toEqual(reference.observation?.money);
  expect(exact.stats?.money.applied).toBeGreaterThan(0);
  expect(exact.events.some((event) => event.type === "money")).toBe(false);
  expect(reference.events.some((event) => event.type === "money")).toBe(false);
  expect(exact.observation?.money.status).toBe("observed");
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-measured-bench The 30d and 90d rows are measured.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-measured-bench #993ad19 Re-read the section, then ran this function: both horizons have finite times and rss.
 * @evidence ./advance.ts#advanceMeasuredBench Reads the bench marker.
 * @evidenceReview ./advance.ts#advanceMeasuredBench #2697893 The declaration is no-unmeasured-speedup.
 * @evidence ./advance.ts#measureAdvanceRow Records the measured row.
 * @evidenceReview ./advance.ts#measureAdvanceRow #69131db The row keeps both durations and the wallet match and fills rss from the process.
 */
export function measuresLongHorizons(): void {
  expect(advanceMeasuredBench).toBe("no-unmeasured-speedup");
  const source = readFileSync(new URL("./advance.ts", import.meta.url), "utf8");
  expect(source.includes("times faster")).toBe(false);
  for (const row of fixture.bench) {
    const fixedScenario = scenario({
      advance: false,
      until: false,
      durationSec: row.horizonSec,
      stepSec: row.stepSec,
    });
    const exactScenario = scenario({
      until: false,
      durationSec: row.horizonSec,
      stepSec: row.stepSec,
      chunkSec: row.horizonSec,
    });
    const fixedStart = performance.now();
    const fixed = runScenario(fixedScenario);
    const fixedMs = performance.now() - fixedStart;
    const exactStart = performance.now();
    const exact = runScenario(exactScenario);
    const exactMs = performance.now() - exactStart;
    const measured = measureAdvanceRow({
      horizonSec: row.horizonSec,
      stepSec: row.stepSec,
      fixedMs,
      exactMs,
      walletMatch: exact.end.wallet.money.amount === fixed.end.wallet.money.amount,
    });
    expect(measured.walletMatch).toBe(true);
    expect(Number.isFinite(measured.fixedMs)).toBe(true);
    expect(Number.isFinite(measured.exactMs)).toBe(true);
    expect(measured.rssBytes).toBeGreaterThan(0);
    expect(exact.advance?.status).toBe("exact");
    expect(exact.stats).toEqual(fixed.stats);
  }
}

describe("guarded analytic advance", () => {
  it("matches the reference wallet and goal", matchesReferenceWalletAndGoal);
  it("falls back on an unclear boundary", fallsBackOnUnclearBoundaries);
  it("refuses a policy threshold", refusesPolicyThresholds);
  it("keeps a seeded model on fixed-step", keepsSeededModelsOnFixedStep);
  it("keeps facts when events are omitted", keepsFactsWhenEventsAreOmitted);
  it("measures long horizons", measuresLongHorizons);
});
