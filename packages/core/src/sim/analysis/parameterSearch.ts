import {
  assertDesignParameters,
  designRandom,
  DesignSpaceRejected,
  mapUnit,
  mapUnitPoint,
  type DesignParameterV1,
} from "./designSpace";

/*
 * Budgeted search over a numeric design space: `grid`, `random`, or a small real-coded genetic algorithm (`ga`).
 *
 * The objective is a score the caller computes (lower is better under `minimize`). Null is a failed or censored
 * candidate and never wins. `maxRuns` bounds evaluations before the search starts; `timeLimitMs` stops it between
 * evaluations and is recorded, because wall time is the one input that is not reproducible. Identical mapped
 * candidates are evaluated once. Every random choice is drawn from `seed`.
 */

export type SearchMethod = "grid" | "random" | "ga";

export type SearchEvaluator = (values: Readonly<Record<string, number>>, runIndex: number) => number | null;

export type ParameterSearchOptions = Readonly<{
  parameters: readonly DesignParameterV1[];
  evaluate: SearchEvaluator;
  method: SearchMethod;
  sense?: "minimize" | "maximize";
  seed: number;
  maxRuns: number;
  timeLimitMs?: number;
  /** Injected clock in ms; default `performance.now`. */
  now?: () => number;
  /** GA population. Default min(24, max(4, floor(maxRuns / 4))). */
  population?: number;
  /** Candidates kept in `top`. Default 5. */
  topK?: number;
}>;

export type SearchCandidateV1 = Readonly<{
  runIndex: number;
  values: Readonly<Record<string, number>>;
  score: number | null;
}>;

export type ParameterSearchResultV1 = Readonly<{
  method: SearchMethod;
  sense: "minimize" | "maximize";
  seed: number;
  budget: Readonly<{ maxRuns: number; timeLimitMs: number | null }>;
  runs: number;
  failedRuns: number;
  stoppedBy: "max-runs" | "time-limit" | "exhausted";
  /** Grid levels per parameter, or null for other methods. */
  gridLevels: number | null;
  generations: number | null;
  best: SearchCandidateV1 | null;
  top: readonly SearchCandidateV1[];
  /** Best observed score after each run, in run order. */
  convergence: readonly (number | null)[];
}>;

export const MAX_SEARCH_RUNS = 10_000;

type Clock = () => number;

function defaultClock(): Clock {
  return () => performance.now();
}

export function searchParameters(options: ParameterSearchOptions): ParameterSearchResultV1 {
  assertDesignParameters(options.parameters);
  const { parameters } = options;
  if (!["grid", "random", "ga"].includes(options.method)) {
    throw new DesignSpaceRejected("search method must be grid, random, or ga");
  }
  if (!Number.isInteger(options.maxRuns) || options.maxRuns < 1 || options.maxRuns > MAX_SEARCH_RUNS) {
    throw new DesignSpaceRejected(`search maxRuns must be an integer from 1 to ${MAX_SEARCH_RUNS}`);
  }
  if (options.timeLimitMs !== undefined && !(Number.isFinite(options.timeLimitMs) && options.timeLimitMs > 0)) {
    throw new DesignSpaceRejected("search timeLimitMs must be a finite number > 0");
  }
  const sense = options.sense ?? "minimize";
  const better = (a: number, b: number): boolean => (sense === "minimize" ? a < b : a > b);
  const now = options.now ?? defaultClock();
  const started = now();
  const rng = designRandom(options.seed);

  const evaluated: SearchCandidateV1[] = [];
  const cache = new Map<string, number | null>();
  const convergence: (number | null)[] = [];
  let best: SearchCandidateV1 | null = null;
  let failedRuns = 0;
  let stoppedBy: ParameterSearchResultV1["stoppedBy"] = "exhausted";

  const outOfTime = (): boolean => options.timeLimitMs !== undefined && now() - started >= options.timeLimitMs;

  /** Score of a unit point, or undefined when the budget stopped the search. */
  const score = (unit: readonly number[]): number | null | undefined => {
    const values = mapUnitPoint(parameters, unit);
    const key = JSON.stringify(parameters.map((parameter) => values[parameter.id]));
    if (cache.has(key)) return cache.get(key)!;
    if (evaluated.length >= options.maxRuns) {
      stoppedBy = "max-runs";
      return undefined;
    }
    if (outOfTime()) {
      stoppedBy = "time-limit";
      return undefined;
    }
    const runIndex = evaluated.length;
    const raw = options.evaluate(values, runIndex);
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (value === null) failedRuns += 1;
    cache.set(key, value);
    const candidate = { runIndex, values, score: value };
    evaluated.push(candidate);
    if (value !== null && (best === null || best.score === null || better(value, best.score))) best = candidate;
    convergence.push(best?.score ?? null);
    return value;
  };

  let gridLevels: number | null = null;
  let generations: number | null = null;

  if (options.method === "grid") {
    const k = parameters.length;
    let levels = Math.max(2, Math.floor(Math.pow(options.maxRuns, 1 / k) + 1e-9));
    while (levels > 2 && Math.pow(levels, k) > options.maxRuns) levels -= 1;
    gridLevels = levels;
    const total = Math.pow(levels, k);
    for (let index = 0; index < total; index += 1) {
      const unit: number[] = [];
      let rest = index;
      for (let d = 0; d < k; d += 1) {
        unit.push((rest % levels) / (levels - 1));
        rest = Math.floor(rest / levels);
      }
      if (score(unit) === undefined) break;
    }
  } else if (options.method === "random") {
    for (let proposals = 0; proposals < options.maxRuns * 20; proposals += 1) {
      if (score(parameters.map(() => rng())) === undefined) break;
      if (evaluated.length >= options.maxRuns) {
        stoppedBy = "max-runs";
        break;
      }
    }
  } else {
    const population = options.population ?? Math.min(24, Math.max(4, Math.floor(options.maxRuns / 4)));
    if (!Number.isInteger(population) || population < 4 || population > 1000) {
      throw new DesignSpaceRejected("ga population must be an integer from 4 to 1000");
    }
    const mutationRate = 1 / parameters.length;
    type Individual = { unit: number[]; score: number | null };
    const fitter = (a: Individual, b: Individual): boolean =>
      a.score !== null && (b.score === null || better(a.score, b.score));
    let pool: Individual[] = [];
    let stopped = false;
    for (let i = 0; i < population; i += 1) {
      const unit = parameters.map(() => rng());
      const value = score(unit);
      if (value === undefined) {
        stopped = true;
        break;
      }
      pool.push({ unit, score: value });
    }
    generations = 0;
    let proposals = 0;
    while (!stopped && pool.length >= 2 && proposals < options.maxRuns * 20) {
      const ranked = [...pool].sort((a, b) => (fitter(a, b) ? -1 : fitter(b, a) ? 1 : 0));
      const next: Individual[] = [ranked[0]!];
      const tournament = (): Individual => {
        const a = pool[Math.floor(rng() * pool.length)]!;
        const b = pool[Math.floor(rng() * pool.length)]!;
        return fitter(b, a) ? b : a;
      };
      while (next.length < population) {
        proposals += 1;
        const p1 = tournament();
        const p2 = tournament();
        const child = p1.unit.map((gene, d) => {
          // BLX-0.5 blend crossover, then Gaussian mutation, in unit space.
          const lo = Math.min(gene, p2.unit[d]!);
          const hi = Math.max(gene, p2.unit[d]!);
          const span = hi - lo;
          let value = lo - 0.5 * span + rng() * 2 * span;
          if (rng() < mutationRate) {
            const gaussian = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
            value += 0.15 * gaussian;
          }
          return Math.min(1, Math.max(0, value));
        });
        // Snap an integer gene to its grid so the cache sees the candidate the run will read.
        parameters.forEach((parameter, d) => {
          if (!parameter.integer) return;
          const mapped = mapUnit(parameter, child[d]!);
          child[d] = parameter.scale === "log"
            ? (Math.log(mapped) - Math.log(parameter.min)) / (Math.log(parameter.max) - Math.log(parameter.min))
            : (mapped - parameter.min) / (parameter.max - parameter.min);
        });
        const value = score(child);
        if (value === undefined) {
          stopped = true;
          break;
        }
        next.push({ unit: child, score: value });
      }
      pool = next;
      generations += 1;
    }
  }

  if (stoppedBy === "exhausted" && evaluated.length >= options.maxRuns) stoppedBy = "max-runs";
  const top = evaluated
    .filter((candidate) => candidate.score !== null)
    .sort((a, b) => (better(a.score!, b.score!) ? -1 : better(b.score!, a.score!) ? 1 : a.runIndex - b.runIndex))
    .slice(0, options.topK ?? 5);
  return {
    method: options.method,
    sense,
    seed: options.seed,
    budget: { maxRuns: options.maxRuns, timeLimitMs: options.timeLimitMs ?? null },
    runs: evaluated.length,
    failedRuns,
    stoppedBy,
    gridLevels,
    generations,
    best,
    top,
    convergence,
  };
}
