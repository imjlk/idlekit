import { runScenario } from "../../simulator";
import type { CompiledScenario } from "../../types";
import { deepClonePreservingPrototype } from "../../../utils/deepClone";
import type { StrategyRegistry } from "../registry";
import type { ObjectiveRegistry } from "./registry";
import type { TuneSeedResult } from "./tuner";

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
}): Readonly<{
  score: number;
  seedScores: readonly number[];
  seedResults: readonly TuneSeedResult[];
}> {
  const stratFactory = args.strategyRegistry.get(args.strategyId);
  if (!stratFactory) throw new Error(`Unknown strategy: ${args.strategyId}`);

  const objFactory = args.objectiveRegistry.get(args.objectiveId);
  if (!objFactory) throw new Error(`Unknown objective: ${args.objectiveId}`);

  const objective = objFactory.create(args.objectiveParams ?? objFactory.defaultParams ?? {});
  const seedScores: number[] = [];
  const seedResults: TuneSeedResult[] = [];

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
        // Tuning executes many runs; keep event log disabled to bound memory.
        eventLog: {
          enabled: false,
          maxEvents: 0,
        },
        fast: args.overrides?.fast
          ? { enabled: true, kind: "log-domain", disableMoneyEvents: true }
          : args.baseScenario.run.fast,
      },
      initial: deepClonePreservingPrototype(args.baseScenario.initial),
    };

    const run = runScenario(sc);
    const s = objective.score({ scenario: sc, run });
    seedScores.push(s);
    const worth = sc.model.netWorth?.(sc.ctx as any, run.end as any) ?? run.end.wallet.money;
    seedResults.push({
      seed,
      score: s,
      durationSec: Math.max(0, run.end.t - run.start.t),
      endMoneyLog10: sc.ctx.E.absLog10(run.end.wallet.money.amount),
      endNetWorthLog10: sc.ctx.E.absLog10(worth.amount),
      droppedRate: run.stats?.money.droppedRate ?? 0,
      actionsApplied: run.stats?.actions.applied ?? 0,
    });
  }

  const score = seedScores.reduce((a, b) => a + b, 0) / Math.max(1, seedScores.length);
  return { score, seedScores, seedResults };
}
