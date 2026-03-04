import type { Strategy } from "./types";
import { stepOnce } from "../step";
import type { StepOnceFn } from "../stepTypes";
import { parseMoney } from "../../notation/parseMoney";
import type { Action, BulkQuote, Model, SimContext, SimState } from "../types";
import type { PlannerStrategyParamsV1 } from "./params";
import { stableActions, stableBulkQuotes } from "./stability";

/**
 * Planner MUST use stepOnce for rollouts.
 * Do NOT re-implement simulator tick/payment logic inside planner.
 */
export type PlannerDeps<N, U extends string, Vars> = Readonly<{
  stepOnce: StepOnceFn<N, U, Vars>;
}>;

type Decision<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
}>;

type PlannerNode<N, U extends string, Vars> = Readonly<{
  state: SimState<N, U, Vars>;
  firstDecision?: Decision<N, U, Vars>;
  reachedTargetAtSec?: number;
  score: number;
}>;

function worthAmount<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  state: SimState<N, U, Vars>,
  series: "netWorth" | "money",
): N {
  if (series === "netWorth") {
    return (model.netWorth?.(ctx, state) ?? state.wallet.money).amount;
  }
  return state.wallet.money.amount;
}

function safeParseTarget<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
): N | undefined {
  if (params.objective !== "minTimeToTargetWorth" || !params.targetWorth) return undefined;
  try {
    return parseMoney(ctx.E, params.targetWorth, {
      unit: ctx.unit,
      suffix: { kind: "alphaInfinite", minLen: 2 },
    }).amount;
  } catch {
    return undefined;
  }
}

function scoreQuote<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  quote: BulkQuote<N, U>,
): number {
  const equivalentAmount = quote.equivalentCost?.amount;
  const costAmount = quote.cost?.amount;
  const deltaAmount = quote.deltaIncomePerSec?.amount;
  const useCostAmount = equivalentAmount ?? costAmount;

  if (params.objective === "maximizePrestigePerHour") {
    return deltaAmount ? ctx.E.absLog10(deltaAmount) : Number.NEGATIVE_INFINITY;
  }

  if (params.objective === "minTimeToTargetWorth") {
    if (!deltaAmount || !useCostAmount) return Number.NEGATIVE_INFINITY;
    return -(ctx.E.absLog10(useCostAmount) - ctx.E.absLog10(deltaAmount));
  }

  const horizonSteps = Math.max(1, params.horizonSteps);
  const delta = deltaAmount ? ctx.E.absLog10(deltaAmount) + Math.log10(horizonSteps) : Number.NEGATIVE_INFINITY;
  const cost = useCostAmount ? ctx.E.absLog10(useCostAmount) : Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(delta)) return Number.isFinite(cost) ? -cost : Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(cost)) return delta;
  return delta - cost;
}

function selectBulkQuote<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  action: Action<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
): BulkQuote<N, U> {
  const quotes = action.bulk?.(ctx, state);
  const stable = quotes && quotes.length > 0
    ? stableBulkQuotes(quotes)
    : [{ size: 1, cost: action.cost(ctx, state), equivalentCost: action.equivalentCost?.(ctx, state) }];

  if ((params.bulk?.mode ?? "bestQuote") === "size1") {
    return stable.find((q) => q.size === 1) ?? stable[0]!;
  }

  let best = stable[0]!;
  let bestScore = scoreQuote(params, ctx, best);
  for (let i = 1; i < stable.length; i++) {
    const q = stable[i]!;
    const score = scoreQuote(params, ctx, q);
    if (score > bestScore) {
      best = q;
      bestScore = score;
    }
  }
  return best;
}

function buildStepCandidates<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  state: SimState<N, U, Vars>,
): readonly Decision<N, U, Vars>[] {
  const actions = stableActions(model.actions(ctx, state)).filter((action) => action.canApply(ctx, state));
  const decisions = actions.map((action) => {
    const quote = selectBulkQuote(params, action, ctx, state);
    return {
      action,
      bulkSize: quote.size > 1 ? quote.size : undefined,
    } satisfies Decision<N, U, Vars>;
  });

  decisions.sort((a, b) => {
    if (a.action.id !== b.action.id) return a.action.id < b.action.id ? -1 : 1;
    const ab = a.bulkSize ?? 1;
    const bb = b.bulkSize ?? 1;
    if (ab !== bb) return ab - bb;
    return 0;
  });

  const maxBranchingActions = Math.max(1, params.maxBranchingActions ?? 8);
  return decisions.slice(0, maxBranchingActions);
}

function scoreNode<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  node: PlannerNode<N, U, Vars>,
  elapsedSec: number,
  target?: N,
): number {
  if (params.objective === "maximizePrestigePerHour") {
    const pointsLog = ctx.E.absLog10(node.state.prestige.points);
    const hours = Math.max(1e-12, elapsedSec / 3600);
    return pointsLog - Math.log10(hours);
  }

  const series = params.series ?? "netWorth";
  const worth = worthAmount(ctx, model, node.state, series);
  const worthLog = ctx.E.absLog10(worth);
  if (params.objective !== "minTimeToTargetWorth" || !target) return worthLog;

  if (node.reachedTargetAtSec !== undefined) {
    return 1_000_000 - node.reachedTargetAtSec;
  }
  return worthLog - ctx.E.absLog10(target) - 1_000_000;
}

function compareNodes<N, U extends string, Vars>(
  a: PlannerNode<N, U, Vars>,
  b: PlannerNode<N, U, Vars>,
): number {
  if (a.score !== b.score) return b.score - a.score;

  const aid = a.firstDecision?.action.id ?? "~noop";
  const bid = b.firstDecision?.action.id ?? "~noop";
  if (aid !== bid) return aid < bid ? -1 : 1;

  const ab = a.firstDecision?.bulkSize ?? 1;
  const bb = b.firstDecision?.bulkSize ?? 1;
  return ab - bb;
}

export function createPlannerStrategy<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  deps?: PlannerDeps<N, U, Vars>,
): Strategy<N, U, Vars> {
  const d: PlannerDeps<N, U, Vars> = deps ?? ({ stepOnce } as PlannerDeps<N, U, Vars>);

  return {
    id: "planner",
    decide(ctx, model, state) {
      const horizonSteps = Math.max(1, params.horizonSteps);
      const beamWidth = Math.max(1, params.beamWidth ?? 1);
      const previewFast = params.useFastPreview
        ? { enabled: true as const, kind: "log-domain" as const, disableMoneyEvents: true }
        : undefined;
      const target = safeParseTarget(params, ctx);
      const series = params.series ?? "netWorth";

      let beam: PlannerNode<N, U, Vars>[] = [
        {
          state,
          score: scoreNode(params, ctx, model, { state, score: 0 }, 0, target),
          reachedTargetAtSec:
            target && ctx.E.cmp(worthAmount(ctx, model, state, series), target) >= 0
              ? 0
              : undefined,
        },
      ];

      for (let depth = 0; depth < horizonSteps; depth++) {
        const nextBeam: PlannerNode<N, U, Vars>[] = [];
        for (const node of beam) {
          const candidates = buildStepCandidates(params, ctx, model, node.state);
          const all = [undefined, ...candidates] as const;
          for (const decision of all) {
            const step = d.stepOnce({
              ctx,
              model,
              state: node.state,
              dt: 1,
              decisions: decision ? [decision] : [],
              fast: previewFast,
            });

            const elapsedSec = depth + 1;
            let reachedTargetAtSec = node.reachedTargetAtSec;
            if (reachedTargetAtSec === undefined && target) {
              const amount = worthAmount(ctx, model, step.next, series);
              if (ctx.E.cmp(amount, target) >= 0) {
                reachedTargetAtSec = elapsedSec;
              }
            }

            const firstDecision = node.firstDecision ?? decision;
            const candidateNode: PlannerNode<N, U, Vars> = {
              state: step.next,
              firstDecision,
              reachedTargetAtSec,
              score: 0,
            };
            nextBeam.push({
              ...candidateNode,
              score: scoreNode(params, ctx, model, candidateNode, elapsedSec, target),
            });
          }
        }

        nextBeam.sort(compareNodes);
        beam = nextBeam.slice(0, beamWidth);
      }

      const best = beam.sort(compareNodes)[0];
      if (!best?.firstDecision) return [];
      return [best.firstDecision];
    },
  };
}
