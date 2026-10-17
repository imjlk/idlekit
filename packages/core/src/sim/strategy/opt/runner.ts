import { runScenario } from "../../simulator";
import { assertHorizonReached, runElapsedSec, type CompiledScenario } from "../../types";
import type { StrategyRegistry } from "../registry";
import { cloneCandidateInitial } from "./freshRun";
import type { ObjectiveRegistry } from "./registry";
import type { TuneSeedResult } from "./tuner";
import type { ModelRegistry } from "../../../scenario/registry";
import { modelCreateParams, strategyCreateParams } from "../../../scenario/compile";
import { RunIsolationError, type RunBindOptions } from "../../runFactory";
import { finiteAmountLog10 } from "./finiteAmountLog10";
import { finiteMean } from "./finiteMean";

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
  /** Refuse to share a model closure that the caller declares stateful. */
  statefulModel?: boolean;
}): Readonly<{
  score: number;
  seedScores: readonly number[];
  seedResults: readonly TuneSeedResult[];
}> {
  if (args.seeds.length === 0) throw new RangeError("Tuning requires at least one seed");
  const stratFactory = args.strategyRegistry.get(args.strategyId);
  if (!stratFactory) throw new Error(`Unknown strategy: ${args.strategyId}`);

  const objFactory = args.objectiveRegistry.get(args.objectiveId);
  if (!objFactory) throw new Error(`Unknown objective: ${args.objectiveId}`);

  const objective = objFactory.create(args.objectiveParams ?? objFactory.defaultParams ?? {});
  const seedScores: number[] = [];
  const seedResults: TuneSeedResult[] = [];
  const modelFactory = args.model ? args.modelRegistry?.get(args.model.id, args.model.version) : undefined;
  if (args.model && !args.modelRegistry) throw new Error(`modelRegistry is required to rebuild model ${args.model.id}@${args.model.version}`);
  if (args.model && !modelFactory) throw new Error(`Model not found: ${args.model.id}@${args.model.version}`);
  if (args.statefulModel && !modelFactory) {
    throw new RunIsolationError("Run isolation is unavailable for a stateful model. Pass model and modelRegistry to rebuild its closure.");
  }
  const candidateParams = strategyCreateParams({
    raw: args.params ?? stratFactory.defaultParams ?? {}, schema: stratFactory.paramsSchema,
  }).params;
  const modelParams = modelFactory ? modelCreateParams({ raw: args.model?.params, schema: modelFactory.paramsSchema }) : undefined;

  for (const seed of args.seeds) {
    const openScenario = (): CompiledScenario<any, any, any> => ({
      ...args.baseScenario,
      ctx: {
        ...args.baseScenario.ctx,
        seed,
      },
      strategy: stratFactory.create(candidateParams) as any,
      model: modelFactory ? modelFactory.create(modelParams) as any : args.baseScenario.model,
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
      initial: cloneCandidateInitial(args.baseScenario.initial),
    });
    const sc = openScenario();

    const run = runScenario(sc);
    // Candidates are ranked on the horizon. A budget stop would score a shorter run.
    assertHorizonReached(run, "runCandidateAndScore");
    const worth = sc.model.netWorth?.(sc.ctx as any, run.end as any) ?? run.end.wallet.money;
    const endMoneyLog10 = finiteAmountLog10(sc.ctx.E, run.end.wallet.money.amount);
    const endNetWorthLog10 = finiteAmountLog10(sc.ctx.E, worth.amount);
    const s = objective.score({ scenario: sc, run, evaluation: {
      open: openScenario,
      registries: { models: args.modelRegistry, strategies: args.strategyRegistry },
      isolation: { model: args.model, statefulModel: args.statefulModel, strategy: { id: args.strategyId, params: candidateParams } },
    } });
    if (!Number.isFinite(s)) throw new RangeError(`Objective ${args.objectiveId} must return a finite score (seed ${seed})`);
    seedScores.push(s);
    seedResults.push({
      seed,
      score: s,
      durationSec: Math.max(0, runElapsedSec(run)),
      endMoneyLog10,
      endNetWorthLog10,
      droppedRate: run.stats?.money.droppedRate ?? null,
      actionsApplied: run.stats && run.stats.actions.status === "observed" ? run.stats.actions.applied : null,
    });
  }

  const score = finiteMean(seedScores);
  return { score, seedScores, seedResults };
}
