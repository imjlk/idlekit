import type { Engine } from "../engine/types";
import { deriveDrawSeed, mulberry32 } from "../sim/random";
import { runScenario } from "../sim/simulator";
import { nextBoundary } from "../sim/timeBoundary";
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

function recordedShrinkIdentity(report: ShrinkReport): boolean {
  if (report.predicateId !== "shrink-gap") return false;
  if (report.generatorVersion !== conformanceGeneratorVersion) return false;
  if (!Number.isInteger(report.caseIndex)) return false;
  if (report.caseIndex < 0 || report.caseIndex >= SHRINK_GAP_CASES) return false;
  const domain = seededDomain(report.testSeed, SHRINK_GAP_MIN, SHRINK_GAP_MAX);
  if (domain[report.caseIndex] !== report.original) return false;
  for (let index = 0; index < report.caseIndex; index += 1) {
    const earlier = domain[index];
    if (earlier === undefined || !shrinkGapHolds(earlier)) return false;
  }
  return true;
}

export function replayShrinkReport(report: ShrinkReport): {
  failed: boolean;
  pathOk: boolean;
  shrunk: number;
} {
  let current = report.original;
  let pathOk =
    recordedShrinkIdentity(report) &&
    typeof report.original === "number" &&
    !shrinkGapHolds(report.original);
  let cursor = 0;
  // Each round must list the shrinker's candidates in order, including rejections, and stop at the first keep.
  while (pathOk && typeof current === "number") {
    const expected = shrinkTowardZero(current);
    if (expected.length === 0) break;
    let keptOne = false;
    for (const candidate of expected) {
      const step = report.shrinkingPath[cursor];
      if (!step || step.from !== current || step.to !== candidate) {
        pathOk = false;
        break;
      }
      const shouldKeep = !shrinkGapHolds(candidate);
      if (step.kept !== shouldKeep) {
        pathOk = false;
        break;
      }
      cursor += 1;
      if (shouldKeep) {
        current = candidate;
        keptOne = true;
        break;
      }
    }
    if (!pathOk || !keptOne) break;
  }
  if (cursor !== report.shrinkingPath.length) pathOk = false;
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
  thrown?: string;
} {
  const shrinkingPath: ShrinkStep[] = [];
  let current = original;
  for (let guard = 0; guard < 64; guard += 1) {
    let improved = false;
    try {
      for (const candidate of shrink(current)) {
        const kept = predicateOutcome(predicate, candidate).failed;
        shrinkingPath.push({ from: current, to: candidate, kept });
        if (!kept) continue;
        current = candidate;
        improved = true;
        break;
      }
    } catch (error) {
      const thrown = error instanceof Error ? error.message : String(error);
      return { value: current, shrinkingPath, thrown };
    }
    if (!improved) break;
  }
  return { value: current, shrinkingPath };
}

function runSeededProperty<T>(run: PropertyRun<T>): { ok: true } | { ok: false; report: FailureReport } {
  if (!Number.isInteger(run.cases) || run.cases < 1) {
    return {
      ok: false,
      report: {
        predicateId: run.predicateId,
        generatorVersion: conformanceGeneratorVersion,
        testSeed: run.testSeed,
        gameSeed: null,
        engineId: null,
        modelId: null,
        strategyId: null,
        tickSchedule: null,
        caseIndex: 0,
        original: undefined,
        value: undefined,
        shrinkingPath: [],
        thrown: "cases must be a positive integer",
      },
    };
  }
  if (!Number.isFinite(run.testSeed) || !Number.isInteger(run.testSeed)) {
    return {
      ok: false,
      report: {
        predicateId: run.predicateId,
        generatorVersion: conformanceGeneratorVersion,
        testSeed: run.testSeed,
        gameSeed: null,
        engineId: null,
        modelId: null,
        strategyId: null,
        tickSchedule: null,
        caseIndex: 0,
        original: undefined,
        value: undefined,
        shrinkingPath: [],
        thrown: "testSeed must be a finite integer",
      },
    };
  }
  const rng = createTestRng(run.testSeed);
  for (let index = 0; index < run.cases; index += 1) {
    let original: T;
    try {
      original = run.generate(index, rng);
    } catch (error) {
      const thrown = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        report: {
          predicateId: run.predicateId,
          generatorVersion: conformanceGeneratorVersion,
          testSeed: run.testSeed,
          gameSeed: null,
          engineId: null,
          modelId: null,
          strategyId: null,
          tickSchedule: null,
          caseIndex: index,
          original: undefined,
          value: undefined,
          shrinkingPath: [],
          thrown,
        },
      };
    }
    const outcome = predicateOutcome(run.predicate, original);
    if (!outcome.failed) continue;
    const shrunk = shrinkValue(run.predicate, run.shrink, original);
    if (shrunk.thrown !== undefined) {
      return {
        ok: false,
        report: {
          predicateId: run.predicateId,
          generatorVersion: conformanceGeneratorVersion,
          testSeed: run.testSeed,
          gameSeed: null,
          engineId: null,
          modelId: null,
          strategyId: null,
          tickSchedule: null,
          caseIndex: index,
          original,
          value: shrunk.value,
          shrinkingPath: shrunk.shrinkingPath,
          thrown: shrunk.thrown,
        },
      };
    }
    const shrunkOutcome = predicateOutcome(run.predicate, shrunk.value);
    let identity: CaseIdentity;
    try {
      identity = run.describeCase(shrunk.value, index);
    } catch (error) {
      const thrown = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        report: {
          predicateId: run.predicateId,
          generatorVersion: conformanceGeneratorVersion,
          testSeed: run.testSeed,
          gameSeed: null,
          engineId: null,
          modelId: null,
          strategyId: null,
          tickSchedule: null,
          caseIndex: index,
          original,
          value: shrunk.value,
          shrinkingPath: shrunk.shrinkingPath,
          thrown,
        },
      };
    }
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

function counterexampleTag(kind: string, value?: string): { [SENTINEL_KEY]: string; value?: string } {
  return value === undefined ? { [SENTINEL_KEY]: kind } : { [SENTINEL_KEY]: kind, value };
}

function serializeCounterexample(value: unknown): string {
  const seen = new WeakSet<object>();
  const trusted = new WeakSet<object>();
  const tag = (kind: string, extra?: string): { [SENTINEL_KEY]: string; value?: string } => {
    const encoded = counterexampleTag(kind, extra);
    trusted.add(encoded);
    return encoded;
  };
  try {
    const text = JSON.stringify(
      value,
      (_key, current: unknown) => {
        if (typeof current === "bigint") return `${current}n`;
        if (typeof current === "number" && Number.isNaN(current)) return tag("nan");
        if (typeof current === "number" && current === Number.NEGATIVE_INFINITY) return tag("-infinity");
        if (typeof current === "number" && current === Number.POSITIVE_INFINITY) return tag("infinity");
        if (typeof current === "number" && Object.is(current, -0)) return tag("-0");
        if (typeof current === "symbol") return tag("symbol", String(current));
        if (typeof current === "function") return tag("function", current.name);
        if (current === undefined) return tag("undefined");
        if (typeof current === "object" && current !== null) {
          if (trusted.has(current)) return current;
          if (seen.has(current)) return tag("circular");
          seen.add(current);
          if (Object.prototype.hasOwnProperty.call(current, SENTINEL_KEY)) {
            const fields: Record<string, unknown> = {};
            for (const key of Object.keys(current)) {
              fields[key] = (current as Record<string, unknown>)[key];
            }
            trusted.add(fields);
            const escaped = { [SENTINEL_KEY]: "escaped", fields };
            trusted.add(escaped);
            return escaped;
          }
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

const SENTINEL_KEY = "~idlekit";

/**
 * Fallback values use a private key. A user object that already has that key is wrapped,
 * so `{ "~idlekit": "nan" }` does not compare equal to numeric NaN.
 */
function snapshotTag(tag: string, value?: string): { [SENTINEL_KEY]: string; value?: string } {
  if (value === undefined) return { [SENTINEL_KEY]: tag };
  return { [SENTINEL_KEY]: tag, value };
}

function escapeSentinelKey(record: Record<string, unknown>): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, SENTINEL_KEY)) return record;
  return { [SENTINEL_KEY]: "escaped", fields: record };
}

/** JSON.stringify keeps an enumerable `~idlekit` key, which collides with a fallback tag. */
function containsSentinelKey(item: unknown, seen = new Set<object>()): boolean {
  if (item === null || typeof item !== "object") return false;
  if (seen.has(item)) return false;
  seen.add(item);
  const own = Object.getOwnPropertyDescriptor(item, SENTINEL_KEY);
  if (own?.enumerable === true) return true;
  for (const key of Object.getOwnPropertyNames(item)) {
    if (Array.isArray(item) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (!descriptor || descriptor.enumerable !== true) continue;
    if (descriptor.get !== undefined || !("value" in descriptor)) continue;
    if (containsSentinelKey(descriptor.value, seen)) return true;
  }
  return false;
}

function symbolKeySnapshots(
  item: object,
  seen: WeakMap<object, number>,
  nextId: { value: number },
): unknown[] {
  const symbols: unknown[] = [];
  for (const key of enumerableSymbolKeys(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (!descriptor) continue;
    const value =
      descriptor.get !== undefined || !("value" in descriptor)
        ? snapshotTag("getter")
        : snapshotData(descriptor.value, seen, nextId);
    symbols.push({ [SENTINEL_KEY]: "symbol-key", name: String(key), value });
  }
  return symbols;
}

function withSymbolKeys(value: unknown, symbols: readonly unknown[]): unknown {
  if (symbols.length === 0) return value;
  return { [SENTINEL_KEY]: "symbol-keys", value, symbols };
}

const symbolIdentity = new Map<symbol, number>();
let nextSymbolIdentity = 1;

function describeSymbol(item: symbol): string {
  let id = symbolIdentity.get(item);
  if (id === undefined) {
    id = nextSymbolIdentity;
    nextSymbolIdentity += 1;
    symbolIdentity.set(item, id);
  }
  const rendered = `${String(item)} #${id}`;
  const key = Symbol.keyFor(item);
  if (key === undefined) return rendered;
  return `${rendered} for ${key}`;
}

function describeFunction(item: Function): string {
  let source = "unavailable";
  try {
    source = item.toString();
  } catch {
    // Some host functions refuse toString. The name still distinguishes them.
  }
  return `${item.name} ${item.length} ${source}`;
}

function snapshotData(item: unknown, seen: WeakMap<object, number>, nextId: { value: number }): unknown {
  if (typeof item === "bigint") return snapshotTag("bigint", item.toString());
  if (typeof item === "symbol") return snapshotTag("symbol", describeSymbol(item));
  if (typeof item === "function") return snapshotTag("function", describeFunction(item));
  if (item === undefined) return snapshotTag("undefined");
  if (typeof item === "number") {
    if (Object.is(item, -0)) return snapshotTag("-0");
    if (Number.isNaN(item)) return snapshotTag("nan");
    if (item === Number.POSITIVE_INFINITY) return snapshotTag("infinity");
    if (item === Number.NEGATIVE_INFINITY) return snapshotTag("-infinity");
    return item;
  }
  if (item === null || typeof item !== "object") return item;
  const known = seen.get(item);
  if (known !== undefined) return snapshotTag("cycle", String(known));
  const id = nextId.value;
  nextId.value += 1;
  seen.set(item, id);
  if (Array.isArray(item)) {
    const indexes: number[] = [];
    for (const key of Object.getOwnPropertyNames(item)) {
      if (key === "length") continue;
      if (!/^(?:0|[1-9][0-9]*)$/.test(key)) continue;
      const index = Number(key);
      if (index < item.length) indexes.push(index);
    }
    indexes.sort((left, right) => left - right);
    const elements: unknown[] = [];
    for (const index of indexes) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
      if (!descriptor || descriptor.get !== undefined || !("value" in descriptor)) {
        elements.push(snapshotTag("getter"));
        continue;
      }
      elements.push(snapshotData(descriptor.value, seen, nextId));
    }
    const extras: Record<string, unknown> = {};
    let extraCount = 0;
    for (const key of Object.getOwnPropertyNames(item)) {
      if (key === "length" || isArrayIndexName(key, item.length)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || descriptor.enumerable !== true) continue;
      extraCount += 1;
      if (descriptor.get !== undefined || !("value" in descriptor)) {
        extras[key] = snapshotTag("getter");
        continue;
      }
      extras[key] = snapshotData(descriptor.value, seen, nextId);
    }
    const symbols = symbolKeySnapshots(item, seen, nextId);
    if (indexes.length !== item.length) {
      const entries: Record<string, unknown> = {};
      for (let slot = 0; slot < indexes.length; slot += 1) {
        const index = indexes[slot];
        if (index === undefined) continue;
        entries[String(index)] = elements[slot];
      }
      const sparse =
        extraCount === 0
          ? { [SENTINEL_KEY]: "sparse-array", length: item.length, entries }
          : { [SENTINEL_KEY]: "sparse-array", length: item.length, entries, extras };
      return withSymbolKeys(sparse, symbols);
    }
    if (extraCount === 0) return withSymbolKeys(elements, symbols);
    return withSymbolKeys(
      { [SENTINEL_KEY]: "array-extras", items: elements, extras },
      symbols,
    );
  }
  if (item instanceof Date && !declaresCustomToJson(item)) {
    const time = item.getTime();
    const instant = snapshotTag("date", Number.isNaN(time) ? "invalid" : item.toISOString());
    const fields = ownPropertySnapshot(item, seen, nextId);
    const dated =
      fields.count === 0 ? instant : { [SENTINEL_KEY]: "date-fields", instant, props: fields.value };
    return withSymbolKeys(dated, symbolKeySnapshots(item, seen, nextId));
  }
  if (item instanceof Map) {
    const entries: Array<{ key: unknown; value: unknown }> = [];
    for (const [key, value] of item) {
      entries.push({
        key: snapshotData(key, seen, nextId),
        value: snapshotData(value, seen, nextId),
      });
    }
    return collectionSnapshot("map", entries, item, seen, nextId);
  }
  if (item instanceof Set) {
    const entries: unknown[] = [];
    for (const value of item) entries.push(snapshotData(value, seen, nextId));
    return collectionSnapshot("set", entries, item, seen, nextId);
  }
  const props = ownPropertySnapshot(item, seen, nextId);
  const symbols = symbolKeySnapshots(item, seen, nextId);
  if (declaresCustomToJson(item)) {
    // URL keeps its href only in the hook. A hook that hides fields cannot hide
    // them here, because the own fields are recorded beside its value.
    let hooked: unknown;
    try {
      hooked = snapshotData((item as { toJSON: () => unknown }).toJSON(), seen, nextId);
    } catch {
      hooked = snapshotTag("tojson-threw");
    }
    return withSymbolKeys({ [SENTINEL_KEY]: "tojson", value: hooked, props: props.value }, symbols);
  }
  return withSymbolKeys(props.value, symbols);
}

/** Enumerable own string-keyed data, as the generic record walk reads it. */
function ownPropertySnapshot(
  item: object,
  seen: WeakMap<object, number>,
  nextId: { value: number },
): { count: number; value: unknown } {
  const record: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (!descriptor || descriptor.enumerable !== true) continue;
    if (descriptor.get !== undefined || !("value" in descriptor)) {
      record[key] = snapshotTag("getter");
      continue;
    }
    record[key] = snapshotData(descriptor.value, seen, nextId);
  }
  return { count: Object.keys(record).length, value: escapeSentinelKey(record) };
}

/** A Map or Set subclass can carry fields and symbol keys beside its entries. */
function collectionSnapshot(
  kind: "map" | "set",
  entries: unknown[],
  item: object,
  seen: WeakMap<object, number>,
  nextId: { value: number },
): unknown {
  const props = ownPropertySnapshot(item, seen, nextId);
  const base =
    props.count === 0
      ? { [SENTINEL_KEY]: kind, entries }
      : { [SENTINEL_KEY]: kind, entries, props: props.value };
  return withSymbolKeys(base, symbolKeySnapshots(item, seen, nextId));
}

/** A hook JSON would call. `Date.prototype.toJSON` stays on the JSON path so the instant is kept. */
function declaresCustomToJson(item: object): boolean {
  let current: object | null = item;
  while (current !== null && current !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(current, "toJSON")) {
      if (current === Date.prototype) return false;
      return true;
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

/** JSON drops NaN, Infinity, undefined, functions, and symbols. Those still have to stay distinct. */
function jsonSilentlyDrops(item: unknown, seen = new Set<object>()): boolean {
  if (item === undefined) return true;
  if (item === null) return false;
  const type = typeof item;
  if (type === "number") return !Number.isFinite(item) || Object.is(item, -0);
  if (type === "function" || type === "symbol" || type === "bigint") return true;
  if (type !== "object") return false;
  if (seen.has(item)) return true;
  seen.add(item);
  if (item instanceof Map || item instanceof Set) return true;
  // JSON writes an invalid Date as null, the same text as a null value.
  if (item instanceof Date && Number.isNaN(item.getTime())) return true;
  if (declaresCustomToJson(item)) return true;
  if (Array.isArray(item)) {
    if (arrayIndexCount(item) !== item.length) return true;
    for (const key of Object.getOwnPropertyNames(item)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor) continue;
      const accessor =
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !("value" in descriptor);
      if (isArrayIndexName(key, item.length)) {
        if (accessor) return true;
        if (jsonSilentlyDrops(descriptor.value, seen)) return true;
        continue;
      }
      if (descriptor.enumerable === true) return true;
    }
    return enumerableSymbolKeys(item).length > 0;
  }
  if (enumerableSymbolKeys(item).length > 0) return true;
  for (const key of Object.getOwnPropertyNames(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (!descriptor || descriptor.enumerable !== true) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor)) {
      return true;
    }
    if (jsonSilentlyDrops(descriptor.value, seen)) return true;
  }
  return false;
}

function snapshotText(value: unknown): string {
  if (!jsonSilentlyDrops(value) && !containsSentinelKey(value)) {
    try {
      const text = JSON.stringify(value);
      if (text !== undefined) return text;
    } catch {
      // A throwing toJSON, getter, or cycle uses the plain copy below.
    }
  }
  const plain = snapshotData(value, new WeakMap(), { value: 0 });
  try {
    return JSON.stringify(plain) ?? "unsupported";
  } catch {
    return "unsupported";
  }
}

export function snapshotEconomy<N, U extends string, Vars>(
  engine: Engine<N>,
  state: SimState<N, U, Vars>,
): string {
  return snapshotText({
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
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section and this function: both runs restore the same strategy snapshot, and the check fails when the economy strings differ. A scenario that already has an emitter does not apply.
 */
export function checkReplay<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>): RelationCheck {
  if (scenario.ctx.emit !== undefined) return skip("scenario already has an emitter");
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
    const first = runScenario(scenario);
    if (first.end.t === scenario.initial.t) return skip("replay completed no step");
    const left = snapshotEconomy(scenario.ctx.E, first.end);
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

type RunnerTicks = { readonly dts: readonly number[]; readonly endT: number; readonly elapsedSec: number };

/** The runner's own clock: `nextBoundary` picks each dt and elapsed is their sum. Null when t cannot move. */
function runnerTicks(start: number, step: number, duration: number, maxSteps?: number): RunnerTicks | null {
  if (!(step > 0) || !(duration > 0)) return null;
  if (!Number.isFinite(start) || !Number.isFinite(step) || !Number.isFinite(duration)) return null;
  const dts: number[] = [];
  let time = start;
  let elapsedSec = 0;
  for (;;) {
    const decision = nextBoundary({
      elapsedSec,
      steps: dts.length,
      stepSec: step,
      durationSec: duration,
      untilMet: false,
      hasUntil: false,
      maxSteps,
    });
    if (decision.kind !== "step") return { dts, endT: time, elapsedSec };
    if (time + decision.dt === time || dts.length >= 1_000_000) return null;
    time += decision.dt;
    elapsedSec += decision.dt;
    dts.push(decision.dt);
  }
}

function sameTicks(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((dt, index) => dt === right[index]);
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
  const maxSteps = scenario.run.maxSteps;
  const full = runnerTicks(scenario.initial.t, step, duration);
  if (full === null) return skip("timestamp cannot advance by stepSec");
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps <= full.dts.length)) {
    return skip("maxSteps can stop the run before durationSec");
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
  return deserializeSimState<N, U, Vars>(scenario.ctx.E, JSON.parse(text), {
    unitFactory: unitFactoryFor(scenario),
  });
}

type TailStart<N, U extends string, Vars> = {
  state: SimState<N, U, Vars>;
  strategyState?: unknown;
  persistedStrategy: boolean;
};

/** `JSON.stringify` turns `NaN` into `null`. Reject that corrupted checkpoint. */
function jsonCheckpointPreserves(
  value: unknown,
  seen = new Set<object>(),
  userData = false,
): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  if (Array.isArray(value)) {
    if (userData && !extensibleUserArray(value)) return false;
    if (arrayIndexCount(value) !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get !== undefined || !("value" in descriptor)) return false;
      if (userData && !ordinaryJsonData(descriptor)) return false;
      if (!jsonCheckpointPreserves(descriptor.value, seen, userData)) return false;
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length") continue;
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) return false;
    }
    return true;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype) return false;
  if (userData && !Object.isExtensible(value)) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get !== undefined || !("value" in descriptor)) return false;
    if (descriptor.enumerable !== true) return false;
    if (userData && (descriptor.writable !== true || descriptor.configurable !== true)) return false;
    if (descriptor.value === undefined) {
      // The serializer shell may omit `strategy.state`. Undefined inside that snapshot still fails.
      if (userData || key === "vars") return false;
      continue;
    }
    const nestedUser = userData || key === "vars" || key === "state";
    if (!jsonCheckpointPreserves(descriptor.value, seen, nestedUser)) return false;
  }
  return true;
}

/** A JSON reload starts from the initial strategy, then applies the saved snapshot. */
function jsonResumeCheckpoint<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  engineName: string,
): TailStart<N, U, Vars> | RelationCheck {
  if (varsAliasSerializedState(state)) return skip("vars alias another checkpoint field");
  const strategy = scenario.strategy;
  const persistedStrategy = typeof strategy?.snapshotState === "function";
  const payload = serializeSimState(scenario.ctx.E, state, {
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
  });
  if (!jsonCheckpointPreserves(payload)) return fail("checkpoint is not JSON");
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return fail("checkpoint is not JSON");
  }
  let parsed: ReturnType<typeof parseSimStateJSON>;
  try {
    parsed = parseSimStateJSON(JSON.parse(text) as unknown);
  } catch {
    return fail("checkpoint is not JSON");
  }
  try {
    return {
      state: deserializeSimState<N, U, Vars>(scenario.ctx.E, parsed, {
        unitFactory: unitFactoryFor(scenario),
      }),
      strategyState: parsed.strategy?.state,
      persistedStrategy,
    };
  } catch {
    return fail("checkpoint is not JSON");
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
  const splitTicks = wholeTickCount(splitSec, step) ?? 0;
  // The head is the full run's first ticks. A head with its own shorter horizon can clamp
  // its last tick differently. The tail horizon must replay the rest tick for tick.
  const fullTicks = runnerTicks(scenario.initial.t, step, duration);
  const headTicks = runnerTicks(scenario.initial.t, step, duration, splitTicks);
  if (fullTicks === null || headTicks === null) return skip("timestamp cannot advance by stepSec");
  const restTicks = fullTicks.dts.slice(splitTicks);
  const tailDuration = [duration - headTicks.elapsedSec, restTicks.reduce((sum, dt) => sum + dt, 0)].find(
    (candidate) => {
      const tailTicks = runnerTicks(headTicks.endT, step, candidate);
      return tailTicks !== null && tailTicks.endT === fullTicks.endT && sameTicks(tailTicks.dts, restTicks);
    },
  );
  if (tailDuration === undefined) {
    return skip("no tail horizon replays the full run's remaining ticks");
  }
  const initial = bracket.snap();
  try {
    const full = economyAfter(scenario);
    bracket.restore(initial);
    const head = runScenario({
      ...scenario,
      run: { ...scenario.run, maxSteps: splitTicks },
    });
    if (head.end.t !== headTicks.endT) {
      return skip("head stopped before the checkpoint");
    }
    if (scenario.run.until?.(head.end)) {
      return skip("until is already true at the checkpoint");
    }
    const started = startTail(head.end);
    if ("applicable" in started) return started;
    if (started.persistedStrategy) {
      bracket.restore(initial);
      bracket.restore(started.strategyState);
    } else {
      bracket.restore(bracket.snap());
    }
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

function extensibleUserArray(value: unknown[]): boolean {
  if (!Object.isExtensible(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  return (
    lengthDescriptor?.writable === true &&
    lengthDescriptor.enumerable === false &&
    lengthDescriptor.configurable === false &&
    lengthDescriptor.get === undefined &&
    lengthDescriptor.set === undefined
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

function isArrayIndexName(key: string, length: number): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < length;
}

function enumerableSymbolKeys(item: object): symbol[] {
  const keys: symbol[] = [];
  for (const key of Object.getOwnPropertySymbols(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (descriptor?.enumerable === true) keys.push(key);
  }
  return keys;
}

function arrayIndexCount(value: readonly unknown[]): number {
  let count = 0;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "length") continue;
    if (!/^(?:0|[1-9][0-9]*)$/.test(key)) continue;
    if (Number(key) >= value.length) continue;
    count += 1;
  }
  return count;
}

function collectObjects(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length") continue;
      if (!/^(?:0|[1-9][0-9]*)$/.test(key)) continue;
      collectData(value, key, seen);
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
    if (arrayIndexCount(value) !== length) return false;
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
  if (scenario.ctx.emit !== undefined) return skip("scenario already has an emitter");
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
    const keptStats = JSON.stringify(kept.stats ?? null);
    const droppedStats = JSON.stringify(dropped.stats ?? null);
    if (keptStats !== droppedStats) return fail(`stats ${keptStats} != ${droppedStats}`);
    if ((kept.eventLog?.totalSeen ?? 0) < 1) return skip("retention saw no events");
    return pass(`${left}; retained ${kept.events.length}; dropped ${dropped.events.length}`);
  } finally {
    bracket.restore(initial);
  }
}

export function checkObserver<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
): RelationCheck {
  if (scenario.ctx.emit !== undefined) return skip("scenario already has an emitter");
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
    const withoutObserver = economyAfter(scenario);
    if (withObserver !== withoutObserver) return fail(`${withObserver} != ${withoutObserver}`);
    if (observed === 0) return skip("observer saw no events");
    return pass(`${withObserver}; observed batches ${observed}`);
  } finally {
    bracket.restore(initial);
  }
}

export function checkTrialOrder(run: (gameSeed: number) => string, seeds: readonly number[]): RelationCheck {
  if (new Set(seeds).size < 2) return skip("trial order needs at least two distinct seeds");
  const reversed = [...seeds].reverse();
  if (reversed.every((seed, index) => seed === seeds[index])) {
    return skip("reversing the seeds does not change the call order");
  }
  const forward = seeds.map((seed) => ({ seed, snapshot: run(seed) }));
  const backward = reversed.map((seed) => ({ seed, snapshot: run(seed) }));
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
  const expected = runnerTicks(scenario.initial.t, step, duration);
  if (expected === null) return skip("timestamp cannot advance by stepSec");
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps <= expected.dts.length)) {
    return skip("maxSteps can stop the run before durationSec");
  }
  const bracket = strategyBracket(scenario);
  if (isRelationCheck(bracket)) return bracket;
  const initial = bracket.snap();
  try {
    const run = runScenario(scenario);
    if (run.end.t !== expected.endT) {
      return fail(`elapsed ${run.end.t} did not stop at ${expected.endT}`);
    }
    if (run.stop?.steps !== ticks) {
      return fail(`${run.stop?.steps} ticks for ${ticks} whole steps`);
    }
    return pass(`stopped at t=${run.end.t}`);
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
