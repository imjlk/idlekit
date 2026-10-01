import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import { etaAnalytic, etaSimulate } from "../sim/analysis/eta";
import { createScriptedStrategy } from "../sim/strategy/scripted";
import type { Action, CompiledScenario, Model, SimState } from "../sim/types";
import type { Strategy } from "../sim/strategy/types";
import { compareAmounts } from "./compareAmounts";
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
  conformanceGeneratorVersion,
  declaredFlatBulkMatches,
  demonstrateShrinkGap,
  economyAfter,
  expectProperty,
  gameSeedForCase,
  rejectNonPositiveStep,
  replayShrinkReport,
  snapshotEconomy,
} from "./conformance";
import type { RelationCheck } from "./conformanceRun";

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

function scriptedGrant(durationSec: number): CompiledScenario<number, UnitCode, Vars> {
  const engine = createNumberEngine();
  const unit = { code: "COIN" as const };
  const grant: Action<number, UnitCode, Vars> = {
    id: "grant",
    kind: "grant",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({
      ...current,
      vars: { buys: current.vars.buys + 1 },
    }),
  };
  return {
    ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: {
      id: "scripted-grant",
      version: 1,
      income: () => ({ unit, amount: 0 }),
      actions: () => [grant],
    },
    initial: state(engine, 0),
    strategy: createScriptedStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      program: [{ actionId: "grant" }],
      loop: false,
    }),
    run: { stepSec: 1, durationSec },
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
 * @evidence ./conformanceRun.ts#checkReplay Replays the constant-income scenario through the harness.
 * @evidenceReview ./conformanceRun.ts#checkReplay #c6a3c78 checkReplay applies to the constant-income scenario at rate 3, duration 4, and step 1.
 * @evidence ./conformanceRun.ts#demonstrateShrinkGap Builds the shrink-gap report whose value is 1 and whose testSeed is 0xd101.
 * @evidenceReview ./conformanceRun.ts#demonstrateShrinkGap #e31f17f Builds the shrink-gap report whose value is 1 and whose testSeed is 0xd101.
 * @evidence ./conformanceRun.ts#replayShrinkReport Replays the saved report and expects the path to fail closed at 1.
 * @evidenceReview ./conformanceRun.ts#replayShrinkReport #dc2d0cf Replays the saved report and expects the path to fail closed at 1. A rejected step whose from is not the current value fails the path. A to value the shrinker would not propose fails the path.
 * @evidence ./conformanceRun.ts#gameSeedForCase Derives a game seed from 0x51ed and index 0 that is an integer other than that test seed.
 * @evidenceReview ./conformanceRun.ts#gameSeedForCase #39c73b9 Derives a game seed from 0x51ed and index 0 that is an integer other than that test seed.
 * @evidence ./conformanceRun.ts#ShrinkReport.value Expects the shrunk value to be 1.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.value #302e9b3 Expects the shrunk value to be 1.
 * @evidence ./conformanceRun.ts#ShrinkReport.generatorVersion Expects the report generator version to equal conformanceGeneratorVersion.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.generatorVersion #3a33f3a Expects the report generator version to equal conformanceGeneratorVersion.
 * @evidence ./conformanceRun.ts#ShrinkReport.gameSeed Expects the shrink-gap report game seed to be null.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.gameSeed #7cfdfda Expects the shrink-gap report game seed to be null.
 * @evidence ./conformanceRun.ts#ShrinkReport.testSeed Expects the shrink-gap report test seed to be 0xd101.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.testSeed #9feb10a Expects the shrink-gap report test seed to be 0xd101.
 * @evidence ./conformanceRun.ts#ShrinkReport.predicateId The fixture deep-equals the report, including predicateId shrink-gap.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.predicateId #de50b55 The fixture deep-equals the report, including predicateId shrink-gap.
 * @evidence ./conformanceRun.ts#ShrinkReport.engineId The fixture deep-equals the report, including a null engineId.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.engineId #da43186 The fixture deep-equals the report, including a null engineId.
 * @evidence ./conformanceRun.ts#ShrinkReport.modelId The fixture deep-equals the report, including a null modelId.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.modelId #25b280a The fixture deep-equals the report, including a null modelId.
 * @evidence ./conformanceRun.ts#ShrinkReport.strategyId The fixture deep-equals the report, including a null strategyId.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.strategyId #d04084f The fixture deep-equals the report, including a null strategyId.
 * @evidence ./conformanceRun.ts#ShrinkReport.tickSchedule The fixture deep-equals the report, including a null tick schedule.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.tickSchedule #5ec8725 The fixture deep-equals the report, including a null tick schedule.
 * @evidence ./conformanceRun.ts#ShrinkReport.caseIndex The fixture deep-equals the report, including the failing case index.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.caseIndex #734ed99 The fixture deep-equals the report, including the failing case index.
 * @evidence ./conformanceRun.ts#ShrinkReport.original The fixture deep-equals the report, including the original failing integer.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.original #f5b7108 The fixture deep-equals the report, including the original failing integer.
 * @evidence ./conformanceRun.ts#ShrinkReport.shrinkingPath The fixture deep-equals the report, including the shrinking path.
 * @evidenceReview ./conformanceRun.ts#ShrinkReport.shrinkingPath #7bad00f The fixture deep-equals the report, including the shrinking path.
 * @evidence ./conformanceRun.ts#ShrinkStep.from The fixture deep-equals each shrinking step's from value.
 * @evidenceReview ./conformanceRun.ts#ShrinkStep.from #5c04bd3 The fixture deep-equals each shrinking step's from value.
 * @evidence ./conformanceRun.ts#ShrinkStep.to The fixture deep-equals each shrinking step's to value.
 * @evidenceReview ./conformanceRun.ts#ShrinkStep.to #95c10f1 The fixture deep-equals each shrinking step's to value.
 * @evidence ./conformanceRun.ts#ShrinkStep.kept The fixture deep-equals each shrinking step's kept flag.
 * @evidenceReview ./conformanceRun.ts#ShrinkStep.kept #9e0b459 The fixture deep-equals each shrinking step's kept flag.
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
  const skipped = replayShrinkReport({
    ...saved,
    shrinkingPath: [...saved.shrinkingPath, { from: 999, to: 0, kept: false }],
  });
  expect(skipped.pathOk).toBe(false);
  const widened = replayShrinkReport({
    ...saved,
    original: 2,
    shrinkingPath: [{ from: 2, to: 7, kept: true }],
    value: 7,
  });
  expect(widened.pathOk).toBe(false);

  const scenario = constantScenario({ rate: 3, durationSec: 4, stepSec: 1, seed: 11 });
  expectApplicable(checkReplay(scenario));
  const gameSeed = gameSeedForCase(0x51ed, 0);
  expect(gameSeed).not.toBe(0x51ed);
  expect(Number.isInteger(gameSeed)).toBe(true);
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness A property draw records the test seed and a separate game seed, and a JSON round-trip preserves the economy snapshot.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: every constant-replay case passes checkReplay and checkJsonRoundTrip.
 * @evidence ./conformanceRun.ts#expectProperty Runs the constant-replay corpus and expects every case to pass.
 * @evidenceReview ./conformanceRun.ts#expectProperty #46079f1 Runs the constant-replay corpus and expects every case to pass. A bigint or cyclic counterexample still reports the seed, case index, and shrink path.
 * @evidence ./conformanceRun.ts#conformanceCaseCount Uses the harness case count as the corpus size.
 * @evidenceReview ./conformanceRun.ts#conformanceCaseCount #3d7ef65 Uses the harness case count as the corpus size.
 * @evidence ./conformanceRun.ts#PropertyRun.predicateId Sets predicateId to constant-replay.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.predicateId #8bb6534 Sets predicateId to constant-replay.
 * @evidence ./conformanceRun.ts#PropertyRun.testSeed Sets testSeed to 0xc0ffee.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.testSeed #df04338 Sets testSeed to 0xc0ffee.
 * @evidence ./conformanceRun.ts#PropertyRun.cases Sets cases from conformanceCaseCount.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.cases #99d1521 Sets cases from conformanceCaseCount.
 * @evidence ./conformanceRun.ts#PropertyRun.generate Draws rate and duration with rng.int and a derived game seed.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.generate #6180b34 Draws rate and duration with rng.int and a derived game seed.
 * @evidence ./conformanceRun.ts#PropertyRun.shrink Shrinks durationSec and rate toward the minimums.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.shrink #84e219d Shrinks durationSec and rate toward the minimums.
 * @evidence ./conformanceRun.ts#PropertyRun.predicate Requires checkReplay and checkJsonRoundTrip to pass.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.predicate #d795845 Requires checkReplay and checkJsonRoundTrip to pass.
 * @evidence ./conformanceRun.ts#PropertyRun.describeCase Records the game seed, number engine, constant-income model, and tick schedule.
 * @evidenceReview ./conformanceRun.ts#PropertyRun.describeCase #f8f25e9 Records the game seed, number engine, constant-income model, and tick schedule.
 */
export function replaysConstantIncomeAcrossTheFixedSeedCorpus(): void {
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
}

describe("DX-01 conformance harness", () => {
  it("replays a constant-income run and shrinks the gap predicate", replaysConstantIncomeAndShrinksGap);

  it(
    "replays constant income across the fixed seed corpus",
    replaysConstantIncomeAcrossTheFixedSeedCorpus,
  );
});

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness bulk matches repeated single buys only when the fixture declares that equivalence.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: a declared equal total applies, and an undeclared bonus mismatch is skipped.
 * @evidence ./conformanceRun.ts#checkBulk Declared equal totals apply; an undeclared bonus mismatch is skipped.
 * @evidenceReview ./conformanceRun.ts#checkBulk #e513eda Declared equal totals apply; an undeclared bonus mismatch is skipped.
 */
export function checksBulkEqualityOnlyWhenTheFixtureDeclaresIt(): void {
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
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness bulk(n) matches repeated single buys only when the fixture declares that equivalence.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: the seed corpus calls the declared flat-bulk relation, and an undeclared mismatch stays in the other check.
 * @evidence ./conformance.ts#declaredFlatBulkMatches The seed corpus asks the harness whether one quoted flat bulk buy matches the same number of single buys.
 * @evidenceReview ./conformance.ts#declaredFlatBulkMatches #89115c0 Re-read declaredFlatBulkMatches: one quoted flat bulk buy and the same number of single buys return the same wallet string and buy count. Ran this function across the seed corpus.
 */
export function replaysDeclaredFlatBulkAcrossTheSeedCorpus(): void {
  expectProperty({
    predicateId: "declared-flat-bulk",
    testSeed: 0xb011,
    cases: conformanceCaseCount(),
    generate: (_index, rng) => rng.int(2, 12),
    shrink: (value) => (value > 2 ? [value - 1] : []),
    predicate: (size) => declaredFlatBulkMatches(size),
    describeCase: (size, index) => ({
      gameSeed: gameSeedForCase(0xb011, index),
      engineId: "number",
      modelId: "flat-bulk",
      strategyId: null,
      tickSchedule: { stepSec: 0, durationSec: size },
    }),
  });
}

describe("PR-01 bulk equivalence", () => {
  it(
    "checks bulk equality only when the fixture declares it",
    checksBulkEqualityOnlyWhenTheFixtureDeclaresIt,
  );

  it("replays declared flat bulk across the seed corpus", replaysDeclaredFlatBulkAcrossTheSeedCorpus);
});

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The same scenario replays from an on-grid checkpoint, and an off-grid checkpoint does not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: the 0.1 grid resume at 0.2 applies, and the resume at 1.5 does not.
 * @evidence ./conformanceRun.ts#checkDurationBoundary A 4s run at step 1 and a 0.3s run at step 0.1 both apply; an until at t greater than or equal to 3 does not.
 * @evidenceReview ./conformanceRun.ts#checkDurationBoundary #b2b5971 Re-read the function: it snapshots and restores the strategy around the run, and it compares the end time with the timestamp advanced from the run's own start.
 * @evidence ./conformanceRun.ts#rejectNonPositiveStep Step 0 is a failing applicable check.
 * @evidenceReview ./conformanceRun.ts#rejectNonPositiveStep #31155b2 Step 0 is a failing applicable check.
 * @evidence ./conformanceRun.ts#checkResume An off-grid resume at 1.5 does not apply; a 0.2 resume on the 0.1 grid does.
 * @evidenceReview ./conformanceRun.ts#checkResume #db56c7a An off-grid resume at 1.5 does not apply; a 0.2 resume on the 0.1 grid does.
 */
export function stopsOnAPositiveTickGridAndRefusesANonPositiveStep(): void {
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
  const fineGrid = constantScenario({ rate: 2, durationSec: 0.07, stepSec: 0.01 });
  expectApplicable(checkResume(fineGrid, 0.06));
  const shiftedBase = constantScenario({ rate: 2, durationSec: 0.3, stepSec: 0.1 });
  const shifted = { ...shiftedBase, initial: { ...shiftedBase.initial, t: 1 } };
  expectApplicable(checkDurationBoundary(shifted));
  expectApplicable(checkResume(shifted, 0.2));
  const earlyStop = checkDurationBoundary({
    ...scenario,
    run: { ...scenario.run, until: (current) => current.t >= 3 },
  });
  expect(earlyStop.applicable).toBe(false);
  expect(earlyStop.ok).toBe(true);
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Step 1 and 0.5 match for constant income and differ when a purchase threshold sits between them.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: constant income matches across those steps and the threshold buy does not.
 * @evidence ./conformanceRun.ts#economyAfter Runs constant income and the threshold buy at steps 1 and 0.5.
 * @evidenceReview ./conformanceRun.ts#economyAfter #749e95e Runs constant income and the threshold buy at steps 1 and 0.5.
 * @evidence ./conformanceRun.ts#checkSnapshots Constant income matches across those steps; the threshold buy does not.
 * @evidenceReview ./conformanceRun.ts#checkSnapshots #3b0fa96 Constant income matches across those steps; the threshold buy does not.
 */
export function treatsStepSizesAsEqualOnlyForConstantIncome(): void {
  const coarse = economyAfter(constantScenario({ rate: 4, durationSec: 4, stepSec: 1 }));
  const fine = economyAfter(constantScenario({ rate: 4, durationSec: 4, stepSec: 0.5 }));
  expectApplicable(checkSnapshots(coarse, fine, "same"));

  const coarseBuy = economyAfter(thresholdScenario(1));
  const fineBuy = economyAfter(thresholdScenario(0.5));
  expectApplicable(checkSnapshots(coarseBuy, fineBuy, "different"));
}

describe("PR-02 time boundaries", () => {
  it(
    "stops on a positive tick grid and refuses a non-positive step",
    stopsOnAPositiveTickGridAndRefusesANonPositiveStep,
  );

  it(
    "treats step 1 and 0.5 as equal only for constant income",
    treatsStepSizesAsEqualOnlyForConstantIncome,
  );
});

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The same scripted grant replays, resumes on grid, keeps its economy under retention and a recording observer, and preserves the JSON snapshot.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: replay, resume, JSON resume, retention, and the observer all apply, and buys stays 1.
 * @evidence ./conformanceRun.ts#checkResumeFromJson Resumes a 4s scripted grant from JSON at t=2.
 * @evidenceReview ./conformanceRun.ts#checkResumeFromJson #91c215a Resumes a 4s scripted grant from JSON at t=2.
 * @evidence ./conformanceRun.ts#checkRetention Retention applies to the scripted grant.
 * @evidenceReview ./conformanceRun.ts#checkRetention #2924eaf Retention applies to the scripted grant. A negative eventLog.maxEvents fails before the check substitutes another capacity. A run that retains no events is inapplicable.
 * @evidence ./conformanceRun.ts#checkObserver The observer check applies to the scripted grant.
 * @evidenceReview ./conformanceRun.ts#checkObserver #31b124c The observer check applies to the scripted grant. A run that emits no events is inapplicable.
 */
export function replaysOneShotScriptedGrantFromTheSameCursor(): void {
  const scenario = scriptedGrant(2);
  expectApplicable(checkDurationBoundary(scenario));
  expectApplicable(checkJsonRoundTrip(scenario));
  const replay = checkReplay(scenario);
  expectApplicable(replay);
  expect((JSON.parse(replay.summary) as { vars: Vars }).vars.buys).toBe(1);
  expectApplicable(checkResume(scenario, 1));
  expectApplicable(checkResumeFromJson(scriptedGrant(4), 2));
  expectApplicable(checkRetention(scenario));
  const invalidRetention = checkRetention({
    ...scenario,
    run: { ...scenario.run, eventLog: { enabled: true, maxEvents: -1 } },
  });
  expect(invalidRetention.ok).toBe(false);
  expectApplicable(checkObserver(scenario));
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The checkpoint replay applies only when that checkpoint is inside the run.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: a checkpoint at t=5 does not apply when until stops at t=3, and the skipped check stays ok.
 * @evidence ./conformanceRun.ts#checkResume A checkpoint at t=5 does not apply when until stops at t=3.
 * @evidenceReview ./conformanceRun.ts#checkResume #db56c7a A checkpoint at t=5 does not apply when until stops at t=3.
 * @evidence ./conformanceRun.ts#RelationCheck.ok That skipped resume is ok.
 * @evidenceReview ./conformanceRun.ts#RelationCheck.ok #e196dd9 That skipped resume is ok.
 * @evidence ./conformanceRun.ts#RelationCheck.applicable That skipped resume is not applicable.
 * @evidenceReview ./conformanceRun.ts#RelationCheck.applicable #f6fa89c That skipped resume is not applicable.
 * @evidence ./conformanceRun.ts#RelationCheck.summary The JSON summary contains checkpoint.
 * @evidenceReview ./conformanceRun.ts#RelationCheck.summary #7777be8 The JSON summary contains checkpoint.
 */
export function skipsResumeWhoseUntilStopsBeforeTheCheckpoint(): void {
  const scenario = constantScenario({ rate: 1, durationSec: 10, stepSec: 1 });
  const early = {
    ...scenario,
    run: { ...scenario.run, until: (current: SimState<number, UnitCode, Vars>) => current.t >= 3 },
  };
  const memory = checkResume(early, 5);
  const json = checkResumeFromJson(early, 5);
  expect(memory.applicable).toBe(false);
  expect(memory.ok).toBe(true);
  expect(json.applicable).toBe(false);
  expect(json.summary).toContain("checkpoint");
}

describe("stateful strategy and currency identity", () => {
  it(
    "replays a one-shot scripted grant from the same cursor",
    replaysOneShotScriptedGrantFromTheSameCursor,
  );

  it(
    "skips a resume whose until stops before the checkpoint",
    skipsResumeWhoseUntilStopsBeforeTheCheckpoint,
  );

  it("skips a strategy that cannot restore the snapshot it exposes", () => {
    const scenario = constantScenario({ rate: 1, durationSec: 2, stepSec: 1 });
    const partial: Strategy<number, UnitCode, Vars> = {
      id: "partial",
      snapshotState: () => ({ cursor: 0 }),
      decide: () => [],
    };
    const refused = checkReplay({ ...scenario, strategy: partial });
    expect(refused.applicable).toBe(false);
    expect(refused.ok).toBe(true);
  });

  it(
    "records wallet and max-money units on the economy snapshot",
    recordsWalletAndMaxMoneyUnitsOnTheEconomySnapshot,
  );
});

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The harness economy snapshot records the wallet unit and the max-money unit.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: the COIN snapshot records COIN for both units, and a GEM snapshot is a different string.
 * @evidence ./conformanceRun.ts#snapshotEconomy Reads amountUnit and maxUnit for COIN, and a GEM snapshot is a different string.
 * @evidenceReview ./conformanceRun.ts#snapshotEconomy #e1778bf Reads amountUnit and maxUnit for COIN, and a GEM snapshot is a different string.
 */
export function recordsWalletAndMaxMoneyUnitsOnTheEconomySnapshot(): void {
  const engine = createNumberEngine();
  const coin = snapshotEconomy(engine, state(engine, 10));
  const parsed = JSON.parse(coin) as { amountUnit: string; maxUnit: string };
  expect(parsed.amountUnit).toBe("COIN");
  expect(parsed.maxUnit).toBe("COIN");
  const gemState: SimState<number, "GEM", Vars> = {
    t: 0,
    wallet: { money: { unit: { code: "GEM" }, amount: 10 }, bucket: engine.zero() },
    maxMoneyEver: { unit: { code: "GEM" }, amount: 10 },
    prestige: { count: 0, points: engine.zero(), multiplier: engine.from(1) },
    vars: { buys: 0 },
  };
  const gem = snapshotEconomy(engine, gemState);
  expect(gem).not.toBe(coin);
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness An on-grid checkpoint replays from memory and from JSON, and independent trials are compared by game seed.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: memory resume, JSON resume, and the JSON round-trip apply, and the two game seeds stay ordered.
 * @evidence ./conformanceRun.ts#checkJsonRoundTrip The constant-income scenario matches after a JSON round trip.
 * @evidenceReview ./conformanceRun.ts#checkJsonRoundTrip #4c0bb28 Re-read the function: it restores the strategy around the run, accepts a dense array and an empty array, rejects shared refs, symbol keys, non-enumerable names, sparse holes, frozen data, non-extensible objects and arrays, a non-writable array length, a nonstandard array prototype, and enumerable getters before stringify, and the constant-income round trip matches. A vars object that also appears on the wallet, max-money, or prestige graph is inapplicable. Ran this function: the dense round trip passed, and the sparse, frozen, non-extensible, locked-length, custom-prototype, and getter round trips did not.
 * @evidence ./conformanceRun.ts#checkTrialOrder Two distinct game seeds keep distinct economy snapshots.
 * @evidenceReview ./conformanceRun.ts#checkTrialOrder #5e85ee7 Two game seeds keep ordered snapshots. This run uses a seed-dependent income rate, and the two economy snapshots differ.
 */
export function resumesOnTheSameTickGridFromMemoryAndJson(): void {
  const scenario = constantScenario({ rate: 5, durationSec: 6, stepSec: 1, seed: 19 });
  expectApplicable(checkResume(scenario, 2));
  expectApplicable(checkResumeFromJson(scenario, 2));
  expectApplicable(checkJsonRoundTrip(scenario));
  const shared = { n: 1 };
  const aliased = {
    ...scenario,
    initial: { ...scenario.initial, vars: { left: shared, right: shared } as unknown as Vars },
  };
  const sharedRound = checkJsonRoundTrip(aliased);
  expect(sharedRound.ok).toBe(false);
  expect(sharedRound.summary).toContain("JSON");
  const unit = scenario.initial.wallet.money.unit;
  const aliasedUnit = checkJsonRoundTrip({
    ...scenario,
    run: { ...scenario.run, durationSec: 0 },
    initial: { ...scenario.initial, vars: { unit } as unknown as Vars },
  });
  expect(aliasedUnit.ok).toBe(true);
  expect(aliasedUnit.applicable).toBe(false);
  const hidden = Object.defineProperty({ visible: 1 }, "secret", { value: 2, enumerable: false });
  const hiddenRound = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: hidden as unknown as Vars },
  });
  expect(hiddenRound.ok).toBe(false);
  const marked = { visible: 1 } as { visible: number; [tag: symbol]: number };
  marked[Symbol("tag")] = 1;
  const symbolRound = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: marked as unknown as Vars },
  });
  expect(symbolRound.ok).toBe(false);
  const denseRound = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: { items: [1, 2], empty: [] } as unknown as Vars },
  });
  expect(denseRound.ok).toBe(true);
  const sparse = [1];
  delete sparse[0];
  const sparseRound = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: { items: sparse } as unknown as Vars },
  });
  expect(sparseRound.ok).toBe(false);
  const frozenRound = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: Object.freeze({ x: 1 }) as unknown as Vars },
  });
  expect(frozenRound.ok).toBe(false);
  const getterVars = {};
  Object.defineProperty(getterVars, "x", { enumerable: true, configurable: true, get: () => 1 });
  const getterRound = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: getterVars as unknown as Vars },
  });
  expect(getterRound.ok).toBe(false);
  const lockedObject = checkJsonRoundTrip({
    ...scenario,
    initial: { ...scenario.initial, vars: Object.preventExtensions({ x: 1 }) as unknown as Vars },
  });
  expect(lockedObject.ok).toBe(false);
  const lockedArray = checkJsonRoundTrip({
    ...scenario,
    initial: {
      ...scenario.initial,
      vars: { items: Object.preventExtensions([1]) } as unknown as Vars,
    },
  });
  expect(lockedArray.ok).toBe(false);
  const lockedLengthItems = [1];
  Object.defineProperty(lockedLengthItems, "length", { writable: false });
  const lockedLength = checkJsonRoundTrip({
    ...scenario,
    initial: {
      ...scenario.initial,
      vars: { items: lockedLengthItems } as unknown as Vars,
    },
  });
  expect(lockedLength.ok).toBe(false);
  const customPrototype = Object.setPrototypeOf([1], { marker: true });
  const customPrototypeRound = checkJsonRoundTrip({
    ...scenario,
    initial: {
      ...scenario.initial,
      vars: { items: customPrototype } as unknown as Vars,
    },
  });
  expect(customPrototypeRound.ok).toBe(false);
  const gameA = gameSeedForCase(0x51ed, 1);
  const gameB = gameSeedForCase(0x51ed, 2);
  const trial = (gameSeed: number) =>
    economyAfter(
      constantScenario({ rate: 1 + (gameSeed % 97), durationSec: 3, stepSec: 1, seed: gameSeed }),
    );
  expect(trial(gameA)).not.toBe(trial(gameB));
  expectApplicable(checkTrialOrder(trial, [gameA, gameB]));
}

describe("PR-03 resume isolation", () => {
  it(
    "resumes on the same tick grid from memory and from JSON",
    resumesOnTheSameTickGridFromMemoryAndJson,
  );

  it("reports a non-JSON strategy snapshot instead of throwing", () => {
    const scenario = constantScenario({ rate: 5, durationSec: 6, stepSec: 1, seed: 19 });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const cycle = checkResumeFromJson(
      {
        ...scenario,
        strategy: {
          id: "cyclic",
          decide: () => [],
          snapshotState: () => cyclic,
          restoreState: () => {},
        },
      },
      2,
    );
    expect(cycle.ok).toBe(false);
    expect(cycle.applicable).toBe(true);
    const bigint = checkResumeFromJson(
      {
        ...scenario,
        strategy: {
          id: "bigint",
          decide: () => [],
          snapshotState: () => 1n,
          restoreState: () => {},
        },
      },
      2,
    );
    expect(bigint.ok).toBe(false);
    expect(bigint.summary).toContain("JSON");
  });
});

describe("counterexample report", () => {
  it("keeps the seed when the counterexample is cyclic or a bigint", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() =>
      expectProperty({
        predicateId: "cyclic-value",
        testSeed: 0xabc,
        cases: 1,
        generate: () => cyclic,
        shrink: () => [],
        predicate: () => false,
        describeCase: () => ({
          gameSeed: 7,
          engineId: "number",
          modelId: "cyclic",
          strategyId: null,
          tickSchedule: null,
        }),
      }),
    ).toThrow(/"testSeed": 2748/);

    expect(() =>
      expectProperty({
        predicateId: "bigint-value",
        testSeed: 0xdef,
        cases: 1,
        generate: () => 1n,
        shrink: (value) => (value === 1n ? [0n] : []),
        predicate: () => false,
        describeCase: () => ({
          gameSeed: null,
          engineId: null,
          modelId: null,
          strategyId: null,
          tickSchedule: null,
        }),
      }),
    ).toThrow(/1n/);
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
    const silent = constantScenario({ rate: 0, durationSec: 1, stepSec: 1, seed: 1 });
    const silentObserver = checkObserver({
      ...silent,
      ctx: { ...silent.ctx, collectMoneyEvents: false },
    });
    expect(silentObserver.ok).toBe(true);
    expect(silentObserver.applicable).toBe(false);
    const silentRetention = checkRetention({
      ...silent,
      ctx: { ...silent.ctx, collectMoneyEvents: false },
    });
    expect(silentRetention.ok).toBe(true);
    expect(silentRetention.applicable).toBe(false);
  });

  it(
    "bans a negative balance only when debt is disallowed",
    bansNegativeBalanceOnlyWhenDebtIsDisallowed,
  );
});

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness A negative balance fails the check only when the payment policy disallows debt.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: checkNonNegative applies when debt is disallowed and does not apply when debt is allowed.
 * @evidence ./conformanceRun.ts#checkNonNegative A non-negative wallet applies when debt is disallowed, and a negative wallet does not apply when debt is allowed.
 * @evidenceReview ./conformanceRun.ts#checkNonNegative #d87668f A non-negative wallet applies when debt is disallowed, and a negative wallet does not apply when debt is allowed.
 */
export function bansNegativeBalanceOnlyWhenDebtIsDisallowed(): void {
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
}

describe("analysis source labels", () => {
  it(
    "keeps formula seconds apart from executed eta results",
    keepsFormulaSecondsApartFromExecutedEtaResults,
  );
});

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Formula seconds stay labeled apart from executed etaSimulate and etaAnalytic results.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: formula, simulate, and analytic seconds are 3 and the executed modes stay distinct.
 * @evidence ./conformanceRun.ts#checkTimedSources Formula, simulate, and analytic seconds are all 3, and the executed modes stay distinct.
 * @evidenceReview ./conformanceRun.ts#checkTimedSources #25df548 Formula, simulate, and analytic seconds are all 3, and the executed modes stay distinct.
 */
export function keepsFormulaSecondsApartFromExecutedEtaResults(): void {
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
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Cross-engine comparison matches a finite constant-income amount and refuses a number Infinity collapse.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: 24 matches across engines and 1e400 is refused on the number engine.
 * @evidence ./compareAmounts.ts#compareAmounts The number engine and break-infinity engine agree on 24, and 1e400 collapses only on the number engine.
 * @evidenceReview ./compareAmounts.ts#compareAmounts #4af6dfc Re-read compareAmounts: 24 matches by absLog10, and 1e400 returns refused-number-collapse because the number engine is not finite.
 * @evidence ./compareAmounts.ts#AmountComparison.status Expects equal for 24, refused-number-collapse for 1e400, and different for the near-zero and opposite-sign pairs.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.status #62a5942 Expects equal for 24, refused-number-collapse for 1e400, and different for the near-zero and opposite-sign pairs.
 * @evidence ./compareAmounts.ts#AmountComparison.left The collapsed number text is not the break-infinity text.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.left #6b7edef The collapsed number text is not the break-infinity text.
 * @evidence ./compareAmounts.ts#AmountComparison.right The collapsed break-infinity text is not the number text.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.right #33c760e The collapsed break-infinity text is not the number text.
 * @evidence ./compareAmounts.ts#AmountComparison.detail The collapse detail says Infinity collapse is not an amount match.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.detail #e1d350b The collapse detail says Infinity collapse is not an amount match.
 * @evidence ./compareAmounts.ts#AmountSide.engineId Passes number and break-infinity as the side ids.
 * @evidenceReview ./compareAmounts.ts#AmountSide.engineId #f238f2b Passes number and break-infinity as the side ids.
 * @evidence ./compareAmounts.ts#AmountSide.engine Passes the number engine and the break-infinity engine.
 * @evidenceReview ./compareAmounts.ts#AmountSide.engine #7ca5927 Passes the number engine and the break-infinity engine.
 * @evidence ./compareAmounts.ts#AmountSide.amount Passes 24, 1e400, 0, and 1e-13 through the engines' from.
 * @evidenceReview ./compareAmounts.ts#AmountSide.amount #3fc6861 Passes 24, 1e400, 0, and 1e-13 through the engines' from.
 */
export function matchesASafeConstantRunAndRefusesNumberInfinityCollapse(): void {
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
  expect(collapsed.detail).toContain("Infinity collapse");
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
}

describe("engine differential", () => {
  it(
    "matches a safe constant run and refuses number Infinity collapse",
    matchesASafeConstantRunAndRefusesNumberInfinityCollapse,
  );
});
