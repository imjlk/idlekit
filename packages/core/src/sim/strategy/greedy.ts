import type { Action, BulkQuote, Model, SimContext, SimState } from "../types";
import type { GreedyStrategyParamsV1 } from "./params";
import { compareCandidateKey, stableActions, stableBulkQuotes } from "./stability";
import type { Strategy } from "./types";

export type GreedyObjective = GreedyStrategyParamsV1["objective"];

type Candidate<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
  score: number;
  equivCostLog10?: number;
  costLog10?: number;
}>;

function toFallbackQuote<N, U extends string, Vars>(
  action: Action<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
): BulkQuote<N, U> {
  return {
    size: 1,
    cost: action.cost(ctx, state),
    equivalentCost: action.equivalentCost?.(ctx, state),
  };
}

function isAffordable<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  cost: BulkQuote<N, U>["cost"],
): boolean {
  if (!cost) return true;
  if (cost.unit.code !== state.wallet.money.unit.code) return false;
  return ctx.E.cmp(state.wallet.money.amount, cost.amount) >= 0;
}

function chooseQuotes<N, U extends string, Vars>(
  action: Action<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  params: GreedyStrategyParamsV1,
): readonly BulkQuote<N, U>[] {
  const mode = params.bulk?.mode ?? "bestQuote";
  const raw = action.bulk?.(ctx, state);
  const quotes = raw && raw.length > 0 ? stableBulkQuotes(raw) : [toFallbackQuote(action, ctx, state)];

  if (mode === "size1") {
    const q1 = quotes.find((q) => q.size === 1);
    return [q1 ?? quotes[0]!];
  }

  if (mode === "maxAffordable") {
    const cap = params.bulk?.maxSizeCap ?? Number.POSITIVE_INFINITY;
    let chosen: BulkQuote<N, U> | null = null;
    for (const q of quotes) {
      if (q.size > cap) continue;
      if (!isAffordable(ctx, state, q.cost)) continue;
      chosen = q;
    }
    return [chosen ?? quotes[0]!];
  }

  return quotes;
}

function scoreQuote<N, U extends string, Vars>(
  objective: GreedyObjective,
  params: GreedyStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  quote: BulkQuote<N, U>,
): number {
  const equivalentAmount = quote.equivalentCost?.amount;
  const costAmount = quote.cost?.amount;
  const deltaAmount = quote.deltaIncomePerSec?.amount;

  if (objective === "maximizeIncome") {
    if (!deltaAmount) return Number.NEGATIVE_INFINITY;
    return ctx.E.absLog10(deltaAmount);
  }

  if (objective === "minPayback") {
    if (!deltaAmount) return Number.NEGATIVE_INFINITY;

    const costForPayback =
      params.payback?.useEquivalentCost === false ? costAmount : (equivalentAmount ?? costAmount);
    if (!costForPayback) return Number.NEGATIVE_INFINITY;

    const logPayback = ctx.E.absLog10(costForPayback) - ctx.E.absLog10(deltaAmount);
    const capSec = params.payback?.capSec;
    if (capSec !== undefined && capSec > 0 && logPayback > Math.log10(capSec)) {
      return Number.NEGATIVE_INFINITY;
    }
    return -logPayback;
  }

  const horizonSec = Math.max(1, params.netWorth?.horizonSec ?? 900);
  const deltaScore = deltaAmount ? ctx.E.absLog10(deltaAmount) + Math.log10(horizonSec) : Number.NEGATIVE_INFINITY;
  const costScore = equivalentAmount
    ? ctx.E.absLog10(equivalentAmount)
    : costAmount
      ? ctx.E.absLog10(costAmount)
      : Number.NEGATIVE_INFINITY;

  if (!Number.isFinite(deltaScore)) {
    return Number.isFinite(costScore) ? -costScore : Number.NEGATIVE_INFINITY;
  }
  if (!Number.isFinite(costScore)) {
    return deltaScore;
  }
  return deltaScore - costScore;
}

function buildCandidates<N, U extends string, Vars>(
  params: GreedyStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  state: SimState<N, U, Vars>,
): Candidate<N, U, Vars>[] {
  const candidates: Candidate<N, U, Vars>[] = [];
  const actions = stableActions(model.actions(ctx, state));

  for (const action of actions) {
    if (!action.canApply(ctx, state)) continue;
    for (const quote of chooseQuotes(action, ctx, state, params)) {
      const score = scoreQuote(params.objective, params, ctx, quote);
      if (!Number.isFinite(score)) continue;
      candidates.push({
        action,
        bulkSize: quote.size > 1 ? quote.size : undefined,
        score,
        equivCostLog10: quote.equivalentCost ? ctx.E.absLog10(quote.equivalentCost.amount) : undefined,
        costLog10: quote.cost ? ctx.E.absLog10(quote.cost.amount) : undefined,
      });
    }
  }

  candidates.sort((a, b) =>
    compareCandidateKey(
      {
        score: a.score,
        equivCostLog10: a.equivCostLog10,
        costLog10: a.costLog10,
        actionId: a.action.id,
        bulkSize: a.bulkSize,
      },
      {
        score: b.score,
        equivCostLog10: b.equivCostLog10,
        costLog10: b.costLog10,
        actionId: b.action.id,
        bulkSize: b.bulkSize,
      },
    ),
  );

  return candidates;
}

export function createGreedyStrategy<N, U extends string, Vars>(
  params: GreedyStrategyParamsV1,
): Strategy<N, U, Vars> {
  /**
   * Greedy Strategy should:
   * - stabilize action ordering
   * - use BulkQuote.equivalentCost/deltaIncomePerSec when available
   * - for maximizeNetWorth objective, prefer stepOnce-based short preview (not full runScenario)
   */
  const maxPicksPerStep = params.maxPicksPerStep ?? 1;

  return {
    id: "greedy",
    decide(ctx: SimContext<N, U, Vars>, model: Model<N, U, Vars>, state: SimState<N, U, Vars>) {
      const ranked = buildCandidates(params, ctx, model, state);
      if (ranked.length === 0) return [];

      return ranked.slice(0, Math.max(1, maxPicksPerStep)).map((x) => ({
        action: x.action,
        bulkSize: x.bulkSize,
      }));
    },
  };
}
