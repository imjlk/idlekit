import { runScenario } from "../../simulator";
import type { CompiledScenario } from "../../types";
import { deepClonePreservingPrototype } from "../../../utils/deepClone";
import type { StrategyRegistry } from "../registry";
import type { ObjectiveRegistry } from "./registry";

export function runCandidateAndScore(args: {
  baseScenario: CompiledScenario<any, any, any>;
  params: unknown;
  strategyId: string;

  objectiveId: string;
  objectiveParams?: unknown;

  seeds: readonly number[];

  overrides?: Readonly<{ stepSec?: number; durationSec?: number; fast?: boolean }>;

  strategyRegistry: StrategyRegistry;
  objectiveRegistry: ObjectiveRegistry;
}): Readonly<{ score: number; seedScores: readonly number[] }> {
  const stratFactory = args.strategyRegistry.get(args.strategyId);
  if (!stratFactory) throw new Error(`Unknown strategy: ${args.strategyId}`);

  const objFactory = args.objectiveRegistry.get(args.objectiveId);
  if (!objFactory) throw new Error(`Unknown objective: ${args.objectiveId}`);

  const objective = objFactory.create(args.objectiveParams ?? objFactory.defaultParams ?? {});
  const seedScores: number[] = [];

  for (const seed of args.seeds) {
    const sc: CompiledScenario<any, any, any> = {
      ...args.baseScenario,
      ctx: {
        ...args.baseScenario.ctx,
        seed,
      },
      strategy: stratFactory.create(args.params ?? stratFactory.defaultParams ?? {}) as any,
      run: {
        ...args.baseScenario.run,
        stepSec: args.overrides?.stepSec ?? args.baseScenario.run.stepSec,
        durationSec: args.overrides?.durationSec ?? args.baseScenario.run.durationSec,
        fast: args.overrides?.fast
          ? { enabled: true, kind: "log-domain", disableMoneyEvents: true }
          : args.baseScenario.run.fast,
      },
      initial: deepClonePreservingPrototype(args.baseScenario.initial),
    };

    const run = runScenario(sc);
    const s = objective.score({ scenario: sc, run });
    seedScores.push(s);
  }

  const score = seedScores.reduce((a, b) => a + b, 0) / Math.max(1, seedScores.length);
  return { score, seedScores };
}
