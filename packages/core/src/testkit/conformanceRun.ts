import type { Engine } from "../engine/types";
import { deriveDrawSeed, mulberry32 } from "../sim/random";
import { runScenario } from "../sim/simulator";
import type { CompiledScenario, SimState } from "../sim/types";
import { deserializeSimState, serializeSimState } from "../serde/simState";
import { conformanceGeneratorVersion } from "./conformance";

export const SHRINK_GAP_SEED = 0xd101;
export const SHRINK_GAP_CASES = 17;
export const SHRINK_GAP_MIN = 0;
export const SHRINK_GAP_MAX = 16;

export type TickSchedule = {
  readonly stepSec: number;
  readonly durationSec: number;
};

export type ShrinkStep = {
  readonly from: unknown;
  readonly to: unknown;
  readonly kept: boolean;
};

export type ShrinkReport = {
  readonly predicateId: "shrink-gap";
  readonly generatorVersion: number;
  readonly testSeed: number;
  readonly gameSeed: null;
  readonly engineId: null;
  readonly modelId: null;
  readonly strategyId: null;
  readonly tickSchedule: null;
  readonly caseIndex: number;
  readonly original: number;
  readonly value: number;
  readonly shrinkingPath: readonly ShrinkStep[];
};

export type FailureReport = {
  readonly predicateId: string;
  readonly generatorVersion: number;
  readonly testSeed: number;
  readonly gameSeed: number | null;
  readonly engineId: string | null;
  readonly modelId: string | null;
  readonly strategyId: string | null;
  readonly tickSchedule: TickSchedule | null;
  readonly caseIndex: number;
  readonly original: unknown;
  readonly value: unknown;
  readonly shrinkingPath: readonly ShrinkStep[];
};

export type RelationCheck = {
  readonly ok: boolean;
  readonly applicable: boolean;
  readonly summary: string;
};

export type TestRng = {
  int: (min: number, max: number) => number;
};

type CaseIdentity = {
  readonly gameSeed: number | null;
  readonly engineId: string | null;
  readonly modelId: string | null;
  readonly strategyId: string | null;
  readonly tickSchedule: TickSchedule | null;
};

export type PropertyRun<T> = {
  readonly predicateId: string;
  readonly testSeed: number;
  readonly cases: number;
  readonly generate: (index: number, rng: TestRng) => T;
  readonly shrink: (value: T) => readonly T[];
  readonly predicate: (value: T) => boolean;
  readonly describeCase: (value: T, index: number) => CaseIdentity;
};

export function conformanceCaseCount(): number {
  const raw = Number(process.env.CONFORMANCE_CASES ?? "8");
  if (!Number.isInteger(raw) || raw < 1) return 8;
  return raw;
}

export function createTestRng(seed: number): TestRng {
  const next = mulberry32(seed >>> 0);
  return {
    int(min: number, max: number): number {
      const span = max - min + 1;
      return min + Math.floor(next() * span);
    },
  };
}

/** Game RNG seed for one case. It does not consume the test generator stream. */
export function gameSeedForCase(testSeed: number, index: number): number {
  return deriveDrawSeed(testSeed ^ 0xa5a5a5a5, index);
}

/** Passes for `n <= 0` or `n >= 8`. Fails for the open gap `1..7`. */
export function shrinkGapHolds(value: number): boolean {
  return value <= 0 || value >= 8;
}

export function shrinkTowardZero(value: number): number[] {
  if (!Number.isInteger(value) || value === 0) return [];
  const toward = value > 0 ? value - 1 : value + 1;
  const half = Math.trunc(value / 2);
  const candidates = [0, half, toward];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const candidate of candidates) {
    if (candidate === value || seen.has(candidate)) continue;
    if (Math.abs(candidate) >= Math.abs(value)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function seededDomain(seed: number, min: number, max: number): number[] {
  const values: number[] = [];
  for (let value = min; value <= max; value += 1) values.push(value);
  const rng = createTestRng(seed);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapWith = rng.int(0, index);
    const current = values[index];
    const other = values[swapWith];
    if (current === undefined || other === undefined) continue;
    values[index] = other;
    values[swapWith] = current;
  }
  return values;
}

export function demonstrateShrinkGap(): ShrinkReport {
  const domain = seededDomain(SHRINK_GAP_SEED, SHRINK_GAP_MIN, SHRINK_GAP_MAX);
  let found: { index: number; original: number } | null = null;
  for (let index = 0; index < SHRINK_GAP_CASES; index += 1) {
    const value = domain[index];
    if (value === undefined) break;
    if (!shrinkGapHolds(value)) {
      found = { index, original: value };
      break;
    }
  }
  if (!found) throw new Error("shrink-gap seed covered no failing integer");

  const shrinkingPath: ShrinkStep[] = [];
  let current = found.original;
  for (let guard = 0; guard < 64; guard += 1) {
    let improved = false;
    for (const candidate of shrinkTowardZero(current)) {
      const kept = !shrinkGapHolds(candidate);
      shrinkingPath.push({ from: current, to: candidate, kept });
      if (!kept) continue;
      current = candidate;
      improved = true;
      break;
    }
    if (!improved) break;
  }

  return {
    predicateId: "shrink-gap",
    generatorVersion: conformanceGeneratorVersion,
    testSeed: SHRINK_GAP_SEED,
    gameSeed: null,
    engineId: null,
    modelId: null,
    strategyId: null,
    tickSchedule: null,
    caseIndex: found.index,
    original: found.original,
    value: current,
    shrinkingPath,
  };
}

export function replayShrinkReport(report: ShrinkReport): {
  failed: boolean;
  pathOk: boolean;
  shrunk: number;
} {
  let current = report.original;
  let pathOk = true;
  for (const step of report.shrinkingPath) {
    if (typeof step.to !== "number" || typeof step.from !== "number") {
      pathOk = false;
      continue;
    }
    const holds = shrinkGapHolds(step.to);
    if (step.kept) {
      if (holds || step.from !== current) pathOk = false;
      current = step.to;
    } else if (!holds) {
      pathOk = false;
    }
  }
  return {
    failed: !shrinkGapHolds(report.value),
    pathOk: pathOk && current === report.value,
    shrunk: current,
  };
}

function shrinkValue<T>(predicate: (value: T) => boolean, shrink: (value: T) => readonly T[], original: T): {
  value: T;
  shrinkingPath: ShrinkStep[];
} {
  const shrinkingPath: ShrinkStep[] = [];
  let current = original;
  for (let guard = 0; guard < 64; guard += 1) {
    let improved = false;
    for (const candidate of shrink(current)) {
      const kept = !predicate(candidate);
      shrinkingPath.push({ from: current, to: candidate, kept });
      if (!kept) continue;
      current = candidate;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return { value: current, shrinkingPath };
}

export function runSeededProperty<T>(run: PropertyRun<T>): { ok: true } | { ok: false; report: FailureReport } {
  const rng = createTestRng(run.testSeed);
  for (let index = 0; index < run.cases; index += 1) {
    const original = run.generate(index, rng);
    if (run.predicate(original)) continue;
    const identity = run.describeCase(original, index);
    const shrunk = shrinkValue(run.predicate, run.shrink, original);
    return {
      ok: false,
      report: {
        predicateId: run.predicateId,
        generatorVersion: conformanceGeneratorVersion,
        testSeed: run.testSeed,
        gameSeed: identity.gameSeed,
        engineId: identity.engineId,
        modelId: identity.modelId,
        strategyId: identity.strategyId,
        tickSchedule: identity.tickSchedule,
        caseIndex: index,
        original,
        value: shrunk.value,
        shrinkingPath: shrunk.shrinkingPath,
      },
    };
  }
  return { ok: true };
}

export function expectProperty<T>(run: PropertyRun<T>): void {
  const result = runSeededProperty(run);
  if (!result.ok) {
    throw new Error(`conformance counterexample\n${JSON.stringify(result.report, null, 2)}`);
  }
}

function pass(summary: string): RelationCheck {
  return { ok: true, applicable: true, summary };
}

function fail(summary: string): RelationCheck {
  return { ok: false, applicable: true, summary };
}

function skip(summary: string): RelationCheck {
  return { ok: true, applicable: false, summary };
}

export function snapshotEconomy<N, U extends string, Vars>(
  engine: Engine<N>,
  state: SimState<N, U, Vars>,
): string {
  return JSON.stringify({
    t: state.t,
    amount: engine.toString(state.wallet.money.amount),
    bucket: engine.toString(state.wallet.bucket),
    max: engine.toString(state.maxMoneyEver.amount),
    prestige: {
      count: state.prestige.count,
      points: engine.toString(state.prestige.points),
      multiplier: engine.toString(state.prestige.multiplier),
    },
    vars: state.vars,
  });
}

export function economyAfter<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>): string {
  return snapshotEconomy(scenario.ctx.E, runScenario(scenario).end);
}

export function checkReplay<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>): RelationCheck {
  const left = economyAfter(scenario);
  const right = economyAfter(scenario);
  return left === right ? pass(left) : fail(`${left} != ${right}`);
}

/** `0.3 / 0.1` is not an integer in IEEE-754. A tick still counts when the quotient rounds. */
const TICK_SLACK = 1e-8;

function wholeTickCount(total: number, step: number): number | null {
  if (!(step > 0) || !(total > 0) || !Number.isFinite(total) || !Number.isFinite(step)) return null;
  const count = total / step;
  const nearest = Math.round(count);
  if (nearest < 1 || Math.abs(count - nearest) > TICK_SLACK) return null;
  return nearest;
}

function onGrid<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
): RelationCheck | null {
  const step = scenario.run.stepSec;
  const duration = scenario.run.durationSec;
  if (duration === undefined || !(step > 0) || !(duration > 0)) {
    return skip("run has no positive step and duration");
  }
  if (!(splitSec > 0) || splitSec >= duration) return skip("split is outside the run");
  const durationTicks = wholeTickCount(duration, step);
  const splitTicks = wholeTickCount(splitSec, step);
  if (durationTicks === null || splitTicks === null || splitTicks >= durationTicks) {
    return skip("split is not on the original tick grid");
  }
  return null;
}

function restoreJsonCheckpoint<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  engineName: string,
): SimState<N, U, Vars> {
  const text = JSON.stringify(
    serializeSimState(scenario.ctx.E, state, {
      seed: scenario.ctx.seed,
      engineName,
    }),
  );
  return deserializeSimState(scenario.ctx.E, JSON.parse(text));
}

export function checkResume<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
): RelationCheck {
  const refused = onGrid(scenario, splitSec);
  if (refused) return refused;
  const duration = scenario.run.durationSec ?? 0;
  const full = economyAfter(scenario);
  const head = runScenario({
    ...scenario,
    run: { ...scenario.run, durationSec: splitSec },
  });
  const tail = economyAfter({
    ...scenario,
    initial: head.end,
    run: { ...scenario.run, durationSec: duration - splitSec },
  });
  return full === tail ? pass(full) : fail(`${full} != ${tail}`);
}

export function checkResumeFromJson<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
): RelationCheck {
  const refused = onGrid(scenario, splitSec);
  if (refused) return refused;
  const duration = scenario.run.durationSec ?? 0;
  const full = economyAfter(scenario);
  const head = runScenario({
    ...scenario,
    run: { ...scenario.run, durationSec: splitSec },
  });
  const restored = restoreJsonCheckpoint(scenario, head.end, "checkpoint");
  const tail = economyAfter({
    ...scenario,
    initial: restored,
    run: { ...scenario.run, durationSec: duration - splitSec },
  });
  return full === tail ? pass(full) : fail(`${full} != ${tail}`);
}

export function checkJsonRoundTrip<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  const end = runScenario(scenario).end;
  const restored = restoreJsonCheckpoint(scenario, end, "round-trip");
  const left = snapshotEconomy(scenario.ctx.E, end);
  const right = snapshotEconomy(scenario.ctx.E, restored);
  return left === right ? pass(left) : fail(`${left} != ${right}`);
}

export function checkRetention<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  const kept = runScenario(scenario);
  const dropped = runScenario({
    ...scenario,
    run: { ...scenario.run, eventLog: { enabled: false, maxEvents: 0 } },
  });
  const left = snapshotEconomy(scenario.ctx.E, kept.end);
  const right = snapshotEconomy(scenario.ctx.E, dropped.end);
  if (left !== right) return fail(`${left} != ${right}`);
  return pass(`${left}; retained ${kept.events.length}; dropped ${dropped.events.length}`);
}

export function checkObserver<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  let observed = 0;
  const withObserver = economyAfter({
    ...scenario,
    ctx: {
      ...scenario.ctx,
      emit: (events) => {
        observed += events.length;
      },
    },
  });
  const withoutObserver = economyAfter({
    ...scenario,
    ctx: { ...scenario.ctx, emit: undefined },
  });
  if (withObserver !== withoutObserver) return fail(`${withObserver} != ${withoutObserver}`);
  return pass(`${withObserver}; observed batches ${observed}`);
}

export function checkTrialOrder(run: (gameSeed: number) => string, seeds: readonly number[]): RelationCheck {
  const forward = seeds.map((seed) => ({ seed, snapshot: run(seed) }));
  const backward = [...seeds].reverse().map((seed) => ({ seed, snapshot: run(seed) }));
  const normalize = (rows: readonly { seed: number; snapshot: string }[]) =>
    JSON.stringify([...rows].sort((left, right) => left.seed - right.seed));
  const left = normalize(forward);
  const right = normalize(backward);
  return left === right ? pass(left) : fail(`${left} != ${right}`);
}

export function checkSnapshots(left: string, right: string, expectation: "same" | "different"): RelationCheck {
  const same = left === right;
  if (expectation === "same") return same ? pass(left) : fail(`${left} != ${right}`);
  return same ? fail("snapshots matched") : pass("snapshots differed");
}

export function checkBulk(declared: boolean, repeated: string, bulk: string): RelationCheck {
  if (!declared) return skip("bulk equivalence is not declared for this model");
  return repeated === bulk ? pass(repeated) : fail(`${repeated} != ${bulk}`);
}

export function checkNonNegative(allowsDebt: boolean, negative: boolean): RelationCheck {
  if (allowsDebt) return skip("this payment policy allows debt");
  return negative ? fail("balance went negative") : pass("balance stayed non-negative");
}

export function checkDurationBoundary<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  const step = scenario.run.stepSec;
  const duration = scenario.run.durationSec;
  if (duration === undefined || !(step > 0) || !(duration > 0)) {
    return skip("run has no positive step and duration");
  }
  if (scenario.run.until) return skip("until can stop the run before durationSec");
  const ticks = wholeTickCount(duration, step);
  if (ticks === null) return skip("duration is not a multiple of stepSec");
  const end = runScenario(scenario).end;
  const elapsed = end.t - scenario.initial.t;
  if (wholeTickCount(elapsed, step) !== ticks) {
    return fail(`elapsed ${elapsed} did not stop at duration ${duration}`);
  }
  return pass(`stopped at t=${end.t}`);
}

export function rejectNonPositiveStep(stepSec: number): RelationCheck {
  if (stepSec > 0) return pass("stepSec is positive");
  return fail("stepSec must be positive before a run");
}

export function checkTimedSources(parts: {
  formulaSeconds: number;
  simulate: { mode: string; seconds: number };
  analytic: { mode: string; seconds: number };
}): RelationCheck {
  if (parts.simulate.mode !== "simulate" || parts.analytic.mode !== "analytic") {
    return fail("executed modes were not labeled simulate and analytic");
  }
  if (parts.formulaSeconds !== parts.simulate.seconds || parts.formulaSeconds !== parts.analytic.seconds) {
    return fail(
      `formula ${parts.formulaSeconds}; executed simulate ${parts.simulate.seconds}; executed analytic ${parts.analytic.seconds}`,
    );
  }
  return pass(
    `formula ${parts.formulaSeconds}; executed simulate ${parts.simulate.seconds}; executed analytic ${parts.analytic.seconds}`,
  );
}
