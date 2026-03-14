import { deepClonePreservingPrototype } from "../utils/deepClone";
import { simulateSessionPattern, type SessionPatternSpec, type SessionRunResult } from "./session";
import { runScenario } from "./simulator";
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

  for (let drawIndex = 0; drawIndex < draws; drawIndex += 1) {
    const seed = deriveDrawSeed(args.seed, drawIndex);
    const scenario: CompiledScenario<N, U, Vars> = {
      ...args.scenario,
      ctx: {
        ...args.scenario.ctx,
        seed,
      },
      initial: deepClonePreservingPrototype(args.scenario.initial),
    };

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

  return {
    draws,
    seed: args.seed,
    results,
  };
}
