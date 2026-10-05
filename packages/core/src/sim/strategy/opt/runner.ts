import { runScenario } from "../../simulator";
import { assertHorizonReached, runElapsedSec, type CompiledScenario } from "../../types";
import { deepClonePreservingPrototype } from "../../../utils/deepClone";
import type { StrategyRegistry } from "../registry";
import type { ObjectiveRegistry } from "./registry";
import type { TuneSeedResult } from "./tuner";
import type { ModelRegistry } from "../../../scenario/registry";
import type { RunBindOptions } from "../../runFactory";

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
  /** Model source is optional for programmatic stateless models and required to rebuild plugin closures. */
  modelRegistry?: ModelRegistry;
  model?: RunBindOptions["model"];
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
  const modelFactory = args.model ? args.modelRegistry?.get(args.model.id, args.model.version) : undefined;
  if (args.model && !modelFactory) throw new Error(`Model not found: ${args.model.id}@${args.model.version}`);

  for (const seed of args.seeds) {
    const openScenario = (): CompiledScenario<any, any, any> => ({
      ...args.baseScenario,
      ctx: {
        ...args.baseScenario.ctx,
        seed,
      },
      strategy: stratFactory.create(args.params ?? stratFactory.defaultParams ?? {}) as any,
      model: modelFactory ? modelFactory.create(args.model?.params) as any : args.baseScenario.model,
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
    });
    const sc = openScenario();

    const run = runScenario(sc);
    // Candidates are ranked on the horizon. A budget stop would score a shorter run.
    assertHorizonReached(run, "runCandidateAndScore");
    const s = objective.score({ scenario: sc, run, evaluation: {
      open: openScenario,
      registries: { models: args.modelRegistry, strategies: args.strategyRegistry },
      isolation: { model: args.model, strategy: { id: args.strategyId, params: args.params ?? stratFactory.defaultParams ?? {} } },
    } });
    seedScores.push(s);
    const worth = sc.model.netWorth?.(sc.ctx as any, run.end as any) ?? run.end.wallet.money;
    seedResults.push({
      seed,
      score: s,
      durationSec: Math.max(0, runElapsedSec(run)),
      endMoneyLog10: sc.ctx.E.absLog10(run.end.wallet.money.amount),
      endNetWorthLog10: sc.ctx.E.absLog10(worth.amount),
      droppedRate: run.stats?.money.droppedRate ?? null,
      actionsApplied: run.stats && run.stats.actions.status === "observed" ? run.stats.actions.applied : null,
    });
  }

  const score = seedScores.reduce((a, b) => a + b, 0) / Math.max(1, seedScores.length);
  return { score, seedScores, seedResults };
}
