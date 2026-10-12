import { simulateSessionPattern, type SessionPatternSpec, type SessionRunResult } from "./session";
import { runScenario } from "./simulator";
import { createRunFactory, type RunBindOptions, type RunFactoryDeps } from "./runFactory";
import type { CompiledScenario, RunResult } from "./types";
import { logicalDrawId, logicalDrawSeed } from "./random";

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-logical-draws Draws and the base seed are finite. The loop bound is that integer.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-logical-draws #6e3688a Re-read the section: NaN and Infinity do not become an empty result or an open loop, and draw index 2 keeps its seed when the calls are reversed.
 */
export const monteCarloDrawBudget = "finite-integer-draws" as const;

export class MonteCarloRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonteCarloRejected";
  }
}

/** Rejects a request that would clamp NaN into an empty run or loop forever. */
export function assertMonteCarloDrawRequest(draws: number, seed: number, budget?: number): number {
  if (typeof draws !== "number" || !Number.isFinite(draws) || draws < 1) {
    throw new MonteCarloRejected("monte carlo draws must be a finite number >= 1");
  }
  const count = Math.floor(draws);
  if (count < 1) throw new MonteCarloRejected("monte carlo draws must be a finite number >= 1");
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new MonteCarloRejected("monte carlo seed must be finite");
  }
  if (budget !== undefined) {
    if (typeof budget !== "number" || !Number.isFinite(budget) || budget < count) {
      throw new MonteCarloRejected("monte carlo budget must be a finite number >= draws");
    }
  }
  return count;
}

export type MonteCarloMetricEvaluator<N, U extends string, Vars, T> = (args: {
  scenario: CompiledScenario<N, U, Vars>;
  run: RunResult<N, U, Vars>;
  session?: SessionRunResult<N, U, Vars>;
  drawIndex: number;
  seed: number;
}) => T;

export type MonteCarloOptions<N, U extends string, Vars, T> = Readonly<{
  scenario: CompiledScenario<N, U, Vars>;
  draws: number;
  seed: number;
  sessionPattern?: SessionPatternSpec;
  metrics: MonteCarloMetricEvaluator<N, U, Vars, T>;
  /** Upper bound on the floored draw count. Non-finite values throw. */
  budget?: number;
  /** Registries used to construct a new model or strategy for each draw. */
  registries?: RunFactoryDeps;
  /**
   * Per-draw isolation. A snapshot strategy is restored to the cursor captured
   * for this call. A stateful closure without a factory or both snapshot hooks throws
   * when `statefulModel` or `statefulStrategy` is set.
   */
  isolation?: RunBindOptions;
}>;

export type MonteCarloSummary<T> = Readonly<{
  draws: number;
  seed: number;
  results: readonly Readonly<{
    drawIndex: number;
    seed: number;
    metrics: T;
  }>[];
}>;

export function simulateMonteCarlo<N, U extends string, Vars, T>(
  args: MonteCarloOptions<N, U, Vars, T>,
): MonteCarloSummary<T> {
  const draws = assertMonteCarloDrawRequest(args.draws, args.seed, args.budget);
  const results: Array<{ drawIndex: number; seed: number; metrics: T }> = [];
  const binding = createRunFactory(args.registries).bind(args.scenario, args.isolation);

  let failed = false;
  try {
    for (let drawIndex = 0; drawIndex < draws; drawIndex += 1) {
      const seed = logicalDrawSeed(args.seed, drawIndex);
      const scenario = binding.fresh({ trialId: logicalDrawId(drawIndex), seed }).scenario;

      if (args.sessionPattern) {
        const session = simulateSessionPattern({
          scenario,
          pattern: args.sessionPattern,
          seed,
        });
        results.push({
          drawIndex,
          seed,
          metrics: args.metrics({
            scenario,
            run: session.run,
            session,
            drawIndex,
            seed,
          }),
        });
        continue;
      }

      const run = runScenario(scenario);
      results.push({
        drawIndex,
        seed,
        metrics: args.metrics({
          scenario,
          run,
          drawIndex,
          seed,
        }),
      });
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // A release failure must not replace the draw failure that is already unwinding.
    try {
      binding.release();
    } catch (cleanup) {
      if (!failed) throw cleanup;
    }
  }

  return {
    draws,
    seed: args.seed,
    results,
  };
}
