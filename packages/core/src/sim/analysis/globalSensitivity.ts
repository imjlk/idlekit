import {
  assertDesignParameters,
  designRandom,
  DesignSpaceRejected,
  mapUnitPoint,
  shuffled,
  type DesignParameterV1,
} from "./designSpace";

/*
 * Global sensitivity screening over a numeric design space.
 *
 * - `morris`: elementary effects on a p-level grid (r trajectories, r * (k + 1) runs). mu* ranks importance,
 *   sigma flags interaction or non-linearity.
 * - `sobol`: Saltelli (2010) first-order and Jansen total-order estimators from N base rows (N * (k + 2) runs),
 *   with seeded bootstrap intervals.
 *
 * Both are budgeted by `maxRuns` before any run starts. Every random choice is drawn from `seed`.
 * A run that returns null (failed or censored metric) is excluded from the effects it touches and counted.
 */

export type SensitivityEvaluator = (values: Readonly<Record<string, number>>, runIndex: number) => number | null;

export type MorrisOptions = Readonly<{
  parameters: readonly DesignParameterV1[];
  evaluate: SensitivityEvaluator;
  seed: number;
  maxRuns: number;
  /** Grid levels, even and >= 4. Default 4. */
  levels?: number;
}>;

export type MorrisParameterResult = Readonly<{
  id: string;
  /** Mean elementary effect (signed). */
  mu: number | null;
  /** Mean absolute elementary effect: the importance measure. */
  muStar: number | null;
  /** Standard deviation of the effects: interaction or non-linearity. */
  sigma: number | null;
  /** Effects that had both runs observed. */
  effects: number;
  rank: number | null;
}>;

export type MorrisResultV1 = Readonly<{
  method: "morris";
  seed: number;
  levels: number;
  trajectories: number;
  runs: number;
  failedRuns: number;
  parameters: readonly MorrisParameterResult[];
  ranking: readonly string[];
}>;

export type SobolOptions = Readonly<{
  parameters: readonly DesignParameterV1[];
  evaluate: SensitivityEvaluator;
  seed: number;
  maxRuns: number;
  /** Bootstrap resamples for the intervals. Default 200, 0 disables them. */
  bootstrap?: number;
  confidence?: number;
}>;

export type SobolIndex = Readonly<{
  value: number | null;
  interval: Readonly<{ lower: number; upper: number }> | null;
}>;

export type SobolParameterResult = Readonly<{
  id: string;
  firstOrder: SobolIndex;
  totalOrder: SobolIndex;
  rank: number | null;
}>;

export type SobolResultV1 = Readonly<{
  method: "sobol";
  seed: number;
  baseSamples: number;
  runs: number;
  failedRuns: number;
  /** Base rows with every run observed; the estimators read only these. */
  usedSamples: number;
  outputVariance: number | null;
  confidence: number;
  parameters: readonly SobolParameterResult[];
  ranking: readonly string[];
}>;

export const MAX_SENSITIVITY_RUNS = 100_000;

function assertBudget(maxRuns: number, perUnit: number, minUnits: number, label: string): number {
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_SENSITIVITY_RUNS) {
    throw new DesignSpaceRejected(`${label} maxRuns must be an integer from 1 to ${MAX_SENSITIVITY_RUNS}`);
  }
  const units = Math.floor(maxRuns / perUnit);
  if (units < minUnits) {
    throw new DesignSpaceRejected(
      `${label} needs maxRuns >= ${minUnits * perUnit} for ${perUnit} runs per ${label === "morris" ? "trajectory" : "base sample"} (received ${maxRuns})`,
    );
  }
  return units;
}

function observed(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rankBy<T extends { id: string }>(rows: readonly T[], score: (row: T) => number | null): Map<string, number> {
  const ranked = rows
    .map((row) => ({ id: row.id, score: score(row) }))
    .filter((row): row is { id: string; score: number } => row.score !== null && Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return new Map(ranked.map((row, index) => [row.id, index + 1]));
}

export function morrisScreening(options: MorrisOptions): MorrisResultV1 {
  assertDesignParameters(options.parameters);
  const k = options.parameters.length;
  const levels = options.levels ?? 4;
  if (!Number.isInteger(levels) || levels < 4 || levels % 2 !== 0 || levels > 64) {
    throw new DesignSpaceRejected("morris levels must be an even integer from 4 to 64");
  }
  const trajectories = assertBudget(options.maxRuns, k + 1, 2, "morris");
  const rng = designRandom(options.seed);
  const delta = levels / (2 * (levels - 1));
  const effects: number[][] = options.parameters.map(() => []);
  let runs = 0;
  let failedRuns = 0;
  const run = (unit: readonly number[]): number | null => {
    const value = options.evaluate(mapUnitPoint(options.parameters, unit), runs);
    runs += 1;
    if (!observed(value)) {
      failedRuns += 1;
      return null;
    }
    return value;
  };

  for (let r = 0; r < trajectories; r += 1) {
    // A base point on the grid, then one move of ±delta per factor in a seeded order.
    const point = options.parameters.map(() => Math.floor(rng() * levels) / (levels - 1));
    let previous = run(point);
    for (const index of shuffled(rng, options.parameters.map((_, i) => i))) {
      const current = point[index]!;
      const step = current + delta <= 1 + 1e-12 ? delta : -delta;
      point[index] = Math.min(1, Math.max(0, current + step));
      const next = run(point);
      if (previous !== null && next !== null) effects[index]!.push((next - previous) / step);
      previous = next;
    }
  }

  const rows = options.parameters.map((parameter, index) => {
    const ee = effects[index]!;
    if (ee.length === 0) return { id: parameter.id, mu: null, muStar: null, sigma: null, effects: 0 };
    const mu = ee.reduce((sum, value) => sum + value, 0) / ee.length;
    const muStar = ee.reduce((sum, value) => sum + Math.abs(value), 0) / ee.length;
    const sigma = ee.length > 1 ? Math.sqrt(ee.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (ee.length - 1)) : 0;
    return { id: parameter.id, mu, muStar, sigma, effects: ee.length };
  });
  const ranks = rankBy(rows, (row) => row.muStar);
  const parameters = rows.map((row) => ({ ...row, rank: ranks.get(row.id) ?? null }));
  return {
    method: "morris",
    seed: options.seed,
    levels,
    trajectories,
    runs,
    failedRuns,
    parameters,
    ranking: [...parameters].filter((row) => row.rank !== null).sort((a, b) => a.rank! - b.rank!).map((row) => row.id),
  };
}

type SobolRows = Readonly<{ fA: number[]; fB: number[]; fAB: number[][] }>;

function sobolEstimates(rows: SobolRows, k: number): { variance: number; first: number[]; total: number[] } | null {
  const n = rows.fA.length;
  if (n < 2) return null;
  const all = [...rows.fA, ...rows.fB];
  const mean = all.reduce((sum, value) => sum + value, 0) / all.length;
  const variance = all.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (all.length - 1);
  if (!(variance > 0)) return { variance: 0, first: new Array(k).fill(Number.NaN), total: new Array(k).fill(Number.NaN) };
  const first: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < k; i += 1) {
    let s = 0;
    let t = 0;
    for (let j = 0; j < n; j += 1) {
      const ab = rows.fAB[i]![j]!;
      s += rows.fB[j]! * (ab - rows.fA[j]!);
      t += (rows.fA[j]! - ab) ** 2;
    }
    first.push(s / n / variance);
    total.push(t / (2 * n) / variance);
  }
  return { variance, first, total };
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index]!;
}

export function sobolIndices(options: SobolOptions): SobolResultV1 {
  assertDesignParameters(options.parameters);
  const k = options.parameters.length;
  const baseSamples = assertBudget(options.maxRuns, k + 2, 4, "sobol");
  const bootstrap = options.bootstrap ?? 200;
  if (!Number.isInteger(bootstrap) || bootstrap < 0 || bootstrap > 10_000) {
    throw new DesignSpaceRejected("sobol bootstrap must be an integer from 0 to 10000");
  }
  const confidence = options.confidence ?? 0.95;
  if (!(confidence > 0 && confidence < 1)) throw new DesignSpaceRejected("sobol confidence must be in (0, 1)");
  const rng = designRandom(options.seed);
  const A = Array.from({ length: baseSamples }, () => options.parameters.map(() => rng()));
  const B = Array.from({ length: baseSamples }, () => options.parameters.map(() => rng()));
  let runs = 0;
  let failedRuns = 0;
  const run = (unit: readonly number[]): number | null => {
    const value = options.evaluate(mapUnitPoint(options.parameters, unit), runs);
    runs += 1;
    if (!observed(value)) {
      failedRuns += 1;
      return null;
    }
    return value;
  };
  const rows: SobolRows = { fA: [], fB: [], fAB: options.parameters.map(() => []) };
  for (let j = 0; j < baseSamples; j += 1) {
    const a = run(A[j]!);
    const b = run(B[j]!);
    const ab: (number | null)[] = [];
    for (let i = 0; i < k; i += 1) {
      const mixed = A[j]!.slice();
      mixed[i] = B[j]![i]!;
      ab.push(run(mixed));
    }
    // A base row is used only when all of its k + 2 runs were observed, so every estimator reads the same rows.
    if (a === null || b === null || ab.some((value) => value === null)) continue;
    rows.fA.push(a);
    rows.fB.push(b);
    ab.forEach((value, i) => rows.fAB[i]!.push(value!));
  }
  const point = sobolEstimates(rows, k);
  const usedSamples = rows.fA.length;
  const intervals: { first: ({ lower: number; upper: number } | null)[]; total: ({ lower: number; upper: number } | null)[] } = {
    first: new Array(k).fill(null),
    total: new Array(k).fill(null),
  };
  if (point && point.variance > 0 && bootstrap > 0) {
    const boot = designRandom((Math.trunc(options.seed) ^ 0x5bd1e995) >>> 0);
    const firstDraws: number[][] = options.parameters.map(() => []);
    const totalDraws: number[][] = options.parameters.map(() => []);
    for (let b = 0; b < bootstrap; b += 1) {
      const pick = Array.from({ length: usedSamples }, () => Math.floor(boot() * usedSamples));
      const resampled: SobolRows = {
        fA: pick.map((index) => rows.fA[index]!),
        fB: pick.map((index) => rows.fB[index]!),
        fAB: rows.fAB.map((column) => pick.map((index) => column[index]!)),
      };
      const estimate = sobolEstimates(resampled, k);
      if (!estimate || !(estimate.variance > 0)) continue;
      for (let i = 0; i < k; i += 1) {
        firstDraws[i]!.push(estimate.first[i]!);
        totalDraws[i]!.push(estimate.total[i]!);
      }
    }
    const tail = (1 - confidence) / 2;
    for (let i = 0; i < k; i += 1) {
      const f = firstDraws[i]!.sort((x, y) => x - y);
      const t = totalDraws[i]!.sort((x, y) => x - y);
      if (f.length > 1) intervals.first[i] = { lower: percentile(f, tail), upper: percentile(f, 1 - tail) };
      if (t.length > 1) intervals.total[i] = { lower: percentile(t, tail), upper: percentile(t, 1 - tail) };
    }
  }
  const finiteOrNull = (value: number | undefined): number | null => (value !== undefined && Number.isFinite(value) ? value : null);
  const rowsOut = options.parameters.map((parameter, i) => ({
    id: parameter.id,
    firstOrder: { value: finiteOrNull(point?.first[i]), interval: intervals.first[i] ?? null },
    totalOrder: { value: finiteOrNull(point?.total[i]), interval: intervals.total[i] ?? null },
  }));
  const ranks = rankBy(rowsOut, (row) => row.totalOrder.value);
  const parameters = rowsOut.map((row) => ({ ...row, rank: ranks.get(row.id) ?? null }));
  return {
    method: "sobol",
    seed: options.seed,
    baseSamples,
    runs,
    failedRuns,
    usedSamples,
    outputVariance: point ? point.variance : null,
    confidence,
    parameters,
    ranking: [...parameters].filter((row) => row.rank !== null).sort((a, b) => a.rank! - b.rank!).map((row) => row.id),
  };
}
