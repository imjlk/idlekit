import type { Engine } from "../engine/types";
import { deriveDrawSeed, mulberry32 } from "../sim/random";
import { runScenario } from "../sim/simulator";
import type { CompiledScenario, SimState } from "../sim/types";
import { deserializeSimState, parseSimStateJSON, serializeSimState } from "../serde/simState";
import { conformanceGeneratorVersion } from "./conformance";

const SHRINK_GAP_SEED = 0xd101;
const SHRINK_GAP_CASES = 17;
const SHRINK_GAP_MIN = 0;
const SHRINK_GAP_MAX = 16;

type TickSchedule = {
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

type FailureReport = {
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
  readonly thrown?: string;
};

export type RelationCheck = {
  readonly ok: boolean;
  readonly applicable: boolean;
  readonly summary: string;
};

type TestRng = {
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

function createTestRng(seed: number): TestRng {
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
function shrinkGapHolds(value: number): boolean {
  return value <= 0 || value >= 8;
}

function shrinkTowardZero(value: number): number[] {
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
    if (!shrinkTowardZero(current).includes(step.to)) pathOk = false;
    const holds = shrinkGapHolds(step.to);
    if (step.kept) {
      if (holds || step.from !== current) pathOk = false;
      current = step.to;
    } else if (!holds || step.from !== current) {
      pathOk = false;
    }
  }
  return {
    failed: !shrinkGapHolds(report.value),
    pathOk: pathOk && current === report.value,
    shrunk: current,
  };
}

function predicateOutcome<T>(
  predicate: (value: T) => boolean,
  value: T,
): { failed: boolean; thrown?: string } {
  try {
    return { failed: !predicate(value) };
  } catch (error) {
    return { failed: true, thrown: error instanceof Error ? error.message : String(error) };
  }
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
      const kept = predicateOutcome(predicate, candidate).failed;
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

function runSeededProperty<T>(run: PropertyRun<T>): { ok: true } | { ok: false; report: FailureReport } {
  const rng = createTestRng(run.testSeed);
  for (let index = 0; index < run.cases; index += 1) {
    const original = run.generate(index, rng);
    const outcome = predicateOutcome(run.predicate, original);
    if (!outcome.failed) continue;
    const shrunk = shrinkValue(run.predicate, run.shrink, original);
    const shrunkOutcome = predicateOutcome(run.predicate, shrunk.value);
    const identity = run.describeCase(shrunk.value, index);
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
        ...(shrunkOutcome.thrown === undefined ? {} : { thrown: shrunkOutcome.thrown }),
      },
    };
  }
  return { ok: true };
}

function serializeCounterexample(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(
      value,
      (_key, current: unknown) => {
        if (typeof current === "bigint") return `${current}n`;
        if (typeof current === "object" && current !== null) {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      },
      2,
    );
    if (typeof text === "string") return text;
  } catch {
    // A throwing getter or toJSON still has to leave the seed and path readable.
  }
  if (!value || typeof value !== "object") return "unserializable counterexample";
  try {
    const report = value as {
      predicateId?: unknown;
      testSeed?: unknown;
      caseIndex?: unknown;
      shrinkingPath?: unknown;
    };
    const path = Array.isArray(report.shrinkingPath) ? String(report.shrinkingPath.length) : "?";
    return [
      "unserializable counterexample",
      `predicate=${String(report.predicateId)}`,
      `seed=${String(report.testSeed)}`,
      `case=${String(report.caseIndex)}`,
      `path=${path}`,
    ].join(" ");
  } catch {
    return "unserializable counterexample";
  }
}

export function expectProperty<T>(run: PropertyRun<T>): void {
  const result = runSeededProperty(run);
  if (!result.ok) {
    throw new Error(`conformance counterexample\n${serializeCounterexample(result.report)}`);
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
    amountUnit: state.wallet.money.unit.code,
    bucket: engine.toString(state.wallet.bucket),
    max: engine.toString(state.maxMoneyEver.amount),
    maxUnit: state.maxMoneyEver.unit.code,
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

type StrategyBracket = {
  snap: () => unknown;
  restore: (state: unknown) => void;
};

/** Independent runs share one strategy object, so a cursor has to return to where that run started. */
function strategyBracket<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): StrategyBracket | RelationCheck {
  const strategy = scenario.strategy;
  const snap = strategy?.snapshotState;
  const restore = strategy?.restoreState;
  if (!snap && !restore) return { snap: () => undefined, restore: () => {} };
  if (!snap || !restore || !strategy) return skip("strategy exposes only one of snapshotState and restoreState");
  return {
    snap: () => strategy.snapshotState?.(),
    restore: (state) => {
      strategy.restoreState?.(state);
    },
  };
}

function isRelationCheck(value: StrategyBracket | RelationCheck): value is RelationCheck {
  return "applicable" in value;
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Replays one compiled scenario from the same initial strategy snapshot.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section and this function: both runs restore the same strategy snapshot, and the check fails when the economy strings differ.
 */
export function checkReplay<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>): RelationCheck {
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
    const left = economyAfter(scenario);
    bracket.restore(initial);
    const right = economyAfter(scenario);
    return left === right ? pass(left) : fail(`${left} != ${right}`);
  } finally {
    bracket.restore(initial);
  }
}

/** A few ulps cover `0.3 / 0.1`. A real offset such as `1.000000001` stays off the grid. */
function wholeTickCount(total: number, step: number): number | null {
  if (!(step > 0) || !(total > 0) || !Number.isFinite(total) || !Number.isFinite(step)) return null;
  const count = total / step;
  const nearest = Math.round(count);
  const slack = Number.EPSILON * Math.max(1, Math.abs(count)) * 16;
  if (nearest < 1 || Math.abs(count - nearest) > slack) return null;
  return nearest;
}

/** The same repeated addition the simulator uses, starting from the run's own timestamp. */
function advancedTimestamp(start: number, step: number, ticks: number): number {
  let time = start;
  for (let index = 0; index < ticks; index += 1) time += step;
  return time;
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

function unitFactoryFor<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): (code: string) => CompiledScenario<N, U, Vars>["ctx"]["unit"] {
  const unit = scenario.ctx.unit;
  return (code) => (code === unit.code ? unit : ({ code: code as U } as typeof unit));
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
  return deserializeSimState(scenario.ctx.E, JSON.parse(text), {
    unitFactory: unitFactoryFor(scenario),
  });
}

type TailStart<N, U extends string, Vars> = {
  state: SimState<N, U, Vars>;
  strategyState?: unknown;
  persistedStrategy: boolean;
};

/** A JSON reload starts from the initial strategy, then applies the saved snapshot. */
function jsonResumeCheckpoint<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  engineName: string,
): TailStart<N, U, Vars> | RelationCheck {
  const strategy = scenario.strategy;
  const persistedStrategy = typeof strategy?.snapshotState === "function";
  try {
    const text = JSON.stringify(
      serializeSimState(scenario.ctx.E, state, {
        seed: scenario.ctx.seed,
        engineName,
        strategy:
          strategy && persistedStrategy
            ? {
                id: strategy.id,
                version: strategy.stateVersion,
                state: strategy.snapshotState?.(),
              }
            : undefined,
      }),
    );
    const parsed = parseSimStateJSON(JSON.parse(text) as unknown);
    return {
      state: deserializeSimState(scenario.ctx.E, parsed, {
        unitFactory: unitFactoryFor(scenario),
      }),
      strategyState: parsed.strategy?.state,
      persistedStrategy,
    };
  } catch (error) {
    if (error instanceof TypeError) return fail("checkpoint is not JSON");
    throw error;
  }
}

function resumeFromCheckpoint<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
  startTail: (headEnd: SimState<N, U, Vars>) => TailStart<N, U, Vars> | RelationCheck,
): RelationCheck {
  const refused = onGrid(scenario, splitSec);
  if (refused) return refused;
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const step = scenario.run.stepSec;
  const duration = scenario.run.durationSec ?? 0;
  const splitTicks = wholeTickCount(splitSec, step);
  const initial = bracket.snap();
  try {
    const full = economyAfter(scenario);
    bracket.restore(initial);
    const head = runScenario({
      ...scenario,
      run: { ...scenario.run, durationSec: splitSec },
    });
    const expected = splitTicks === null ? undefined : advancedTimestamp(scenario.initial.t, step, splitTicks);
    if (expected === undefined || head.end.t !== expected) {
      return skip("head stopped before the checkpoint");
    }
    const started = startTail(head.end);
    if ("applicable" in started) return started;
    if (started.persistedStrategy) {
      bracket.restore(initial);
      bracket.restore(started.strategyState);
    } else {
      bracket.restore(bracket.snap());
    }
    const durationTicks = wholeTickCount(duration, step);
    if (splitTicks === null || durationTicks === null || durationTicks - splitTicks < 1) {
      return skip("split is not on the original tick grid");
    }
    const remainingTicks = durationTicks - splitTicks;
    const tailStart = started.state.t;
    const tailDuration = advancedTimestamp(tailStart, step, remainingTicks) - tailStart;
    const tail = economyAfter({
      ...scenario,
      initial: started.state,
      run: { ...scenario.run, durationSec: tailDuration },
    });
    return full === tail ? pass(full) : fail(`${full} != ${tail}`);
  } finally {
    bracket.restore(initial);
  }
}

export function checkResume<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
): RelationCheck {
  return resumeFromCheckpoint(scenario, splitSec, (headEnd) => ({
    state: headEnd,
    persistedStrategy: false,
  }));
}

export function checkResumeFromJson<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
): RelationCheck {
  return resumeFromCheckpoint(scenario, splitSec, (headEnd) =>
    jsonResumeCheckpoint(scenario, headEnd, "checkpoint"),
  );
}

function ordinaryJsonData(descriptor: PropertyDescriptor | undefined): boolean {
  return (
    descriptor?.enumerable === true &&
    descriptor.writable === true &&
    descriptor.configurable === true &&
    Object.prototype.hasOwnProperty.call(descriptor, "value") &&
    descriptor.get === undefined &&
    descriptor.set === undefined
  );
}

function collectObjects(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectData(value, String(index), seen);
    }
    return;
  }
  for (const key of Object.keys(value)) collectData(value, key, seen);
}

function collectData(value: object, key: string, seen: Set<object>): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  // Reading a getter can throw before the JSON shape check runs.
  if (
    !descriptor ||
    descriptor.get !== undefined ||
    !Object.prototype.hasOwnProperty.call(descriptor, "value")
  ) {
    return;
  }
  collectObjects(descriptor.value, seen);
}

/** JSON copies every object, so a vars alias into wallet or prestige cannot round-trip. */
function varsAliasSerializedState<N, U extends string, Vars>(state: SimState<N, U, Vars>): boolean {
  const outside = new Set<object>();
  collectObjects(state.wallet, outside);
  collectObjects(state.maxMoneyEver, outside);
  collectObjects(state.prestige, outside);
  const varsObjects = new Set<object>();
  collectObjects(state.vars, varsObjects);
  for (const object of varsObjects) {
    if (outside.has(object)) return true;
  }
  return false;
}

function jsonRoundTripPreserves(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  if (!Object.isExtensible(value)) return false;
  if (Array.isArray(value)) {
    const names = Object.getOwnPropertyNames(value);
    const length = value.length;
    const foreign = names.some((key) => {
      if (key === "length") return false;
      if (!/^(?:0|[1-9]\d*)$/.test(key)) return true;
      return Number(key) >= length;
    });
    if (foreign) return false;
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor?.writable !== true ||
      lengthDescriptor.enumerable !== false ||
      lengthDescriptor.configurable !== false ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, "value") ||
      lengthDescriptor.get !== undefined ||
      lengthDescriptor.set !== undefined
    ) {
      return false;
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!(index in value) || !ordinaryJsonData(descriptor) || !jsonRoundTripPreserves(value[index], seen)) {
        return false;
      }
    }
    return true;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.some((key) => !ordinaryJsonData(Object.getOwnPropertyDescriptor(value, key)))) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((child) => jsonRoundTripPreserves(child, seen));
}

export function checkJsonRoundTrip<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
    const end = runScenario(scenario).end;
    if (varsAliasSerializedState(end)) return skip("vars alias another checkpoint field");
    if (!jsonRoundTripPreserves(end.vars)) return fail("vars do not survive a JSON checkpoint");
    let restored: ReturnType<typeof restoreJsonCheckpoint<N, U, Vars>>;
    try {
      restored = restoreJsonCheckpoint(scenario, end, "round-trip");
    } catch (error) {
      return fail(error instanceof Error ? error.message : "vars do not survive a JSON checkpoint");
    }
    if (
      restored.wallet.money.unit.code === scenario.ctx.unit.code &&
      (restored.wallet.money.unit !== scenario.ctx.unit ||
        restored.maxMoneyEver.unit !== scenario.ctx.unit)
    ) {
      return fail("restored unit is not the scenario unit");
    }
    const originalVars = JSON.stringify(end.vars);
    const restoredVars = JSON.stringify(restored.vars);
    if (originalVars !== restoredVars) return fail(`vars ${originalVars} != ${restoredVars}`);
    const left = snapshotEconomy(scenario.ctx.E, end);
    const right = snapshotEconomy(scenario.ctx.E, restored);
    return left === right ? pass(left) : fail(`${left} != ${right}`);
  } finally {
    bracket.restore(initial);
  }
}

export function checkRetention<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
    const log = scenario.run.eventLog;
    if (log?.maxEvents !== undefined && (!Number.isInteger(log.maxEvents) || log.maxEvents < 0)) {
      return fail(`eventLog.maxEvents ${String(log.maxEvents)} is not an integer >= 0`);
    }
    const records = (log?.enabled ?? true) && (log?.maxEvents === undefined || log.maxEvents > 0);
    const keptScenario = records
      ? scenario
      : { ...scenario, run: { ...scenario.run, eventLog: { enabled: true, maxEvents: 32 } } };
    const kept = runScenario(keptScenario);
    bracket.restore(initial);
    const dropped = runScenario({
      ...scenario,
      run: { ...scenario.run, eventLog: { enabled: false, maxEvents: 0 } },
    });
    const left = snapshotEconomy(scenario.ctx.E, kept.end);
    const right = snapshotEconomy(scenario.ctx.E, dropped.end);
    if (left !== right) return fail(`${left} != ${right}`);
    if ((kept.eventLog?.totalSeen ?? 0) < 1) return skip("retention saw no events");
    return pass(`${left}; retained ${kept.events.length}; dropped ${dropped.events.length}`);
  } finally {
    bracket.restore(initial);
  }
}

export function checkObserver<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
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
    bracket.restore(initial);
    const withoutObserver = economyAfter({
      ...scenario,
      ctx: { ...scenario.ctx, emit: undefined },
    });
    if (withObserver !== withoutObserver) return fail(`${withObserver} != ${withoutObserver}`);
    if (observed === 0) return skip("observer saw no events");
    return pass(`${withObserver}; observed batches ${observed}`);
  } finally {
    bracket.restore(initial);
  }
}

export function checkTrialOrder(run: (gameSeed: number) => string, seeds: readonly number[]): RelationCheck {
  if (new Set(seeds).size < 2) return skip("trial order needs at least two distinct seeds");
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
  const maxSteps = scenario.run.maxSteps;
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps <= ticks)) {
    return skip("maxSteps can stop the run before durationSec");
  }
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
    const end = runScenario(scenario).end;
    const expected = advancedTimestamp(scenario.initial.t, step, ticks);
    if (end.t !== expected) {
      return fail(`elapsed ${end.t} did not stop at ${expected}`);
    }
    return pass(`stopped at t=${end.t}`);
  } finally {
    bracket.restore(initial);
  }
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
