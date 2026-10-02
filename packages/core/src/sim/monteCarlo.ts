import { simulateSessionPattern, type SessionPatternSpec, type SessionRunResult } from "./session";
import { runScenario } from "./simulator";
import { createRunFactory, type RunBindOptions, type RunFactoryDeps } from "./runFactory";
import type { CompiledScenario, RunResult } from "./types";
import { deriveDrawSeed } from "./random";

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
  const draws = Math.max(1, Math.floor(args.draws));
  const results: Array<{ drawIndex: number; seed: number; metrics: T }> = [];
  const binding = createRunFactory(args.registries).bind(args.scenario, args.isolation);

  let failed = false;
  try {
    for (let drawIndex = 0; drawIndex < draws; drawIndex += 1) {
      const seed = deriveDrawSeed(args.seed, drawIndex);
      const scenario = binding.fresh({ trialId: String(drawIndex), seed }).scenario;

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
