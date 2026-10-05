import type { CompiledScenario, RunResult } from "../../types";
import type { RunBindOptions, RunFactoryDeps } from "../../runFactory";

export interface OptimizationObjective<N, U extends string, Vars> {
  id: string;

  score: (args: {
    scenario: CompiledScenario<N, U, Vars>;
    run: RunResult<N, U, Vars>;
    /** Independent analysis runs start here, with the candidate's original factories and params. */
    evaluation?: Readonly<{
      open: () => CompiledScenario<N, U, Vars>;
      registries: RunFactoryDeps;
      isolation: RunBindOptions;
    }>;
  }) => number;
}
