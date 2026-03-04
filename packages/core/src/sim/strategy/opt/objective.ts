import type { CompiledScenario, RunResult } from "../../types";

export interface OptimizationObjective<N, U extends string, Vars> {
  id: string;

  score: (args: {
    scenario: CompiledScenario<N, U, Vars>;
    run: RunResult<N, U, Vars>;
  }) => number;
}
