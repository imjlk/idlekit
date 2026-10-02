import { canSettleCost, singleBuySize } from "../step";
import type { Action, BulkQuote, Model, SimContext, SimState } from "../types";
import type { GreedyStrategyParamsV1 } from "./params";
import {
  actionOccurrence,
  compareCandidateKey,
  quotedDecisionSize,
  rankableQuotes,
  stableActions,
  stableBulkQuotes,
  structuredUnitCode,
  uniqueQuotedSizes,
} from "./stability";
import type { Strategy } from "./types";

export type GreedyObjective = GreedyStrategyParamsV1["objective"];

type Candidate<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
  occurrence: number;
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

function missingAmount(amount: unknown): boolean {
  return amount === undefined || amount === null;
}

function isAffordable<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  cost: BulkQuote<N, U>["cost"],
): boolean {
  if (cost === null) return true;
  if (!cost) return false;
  const costCode = structuredUnitCode(cost);
  if (costCode === undefined || costCode !== structuredUnitCode(state.wallet.money)) return false;
  // Break-infinity reads `mantissa` inside isFinite. A missing amount is not a cost.
  if (missingAmount(cost.amount) || !ctx.E.isFinite(cost.amount)) return false;
  // A negative cost passes a wallet comparison and is then rejected at settlement.
  if (!canSettleCost(ctx.E, cost.amount, ctx.E.zero())) return false;
  return canSettleCost(ctx.E, state.wallet.money.amount, cost.amount);
}

type QuoteChoice<N, U extends string> = Readonly<{
  selected: readonly BulkQuote<N, U>[];
  rejected: readonly BulkQuote<N, U>[];
}>;

function withActionCost<N, U extends string>(
  quote: BulkQuote<N, U>,
  quotedCost: BulkQuote<N, U>["cost"],
): BulkQuote<N, U> {
  if (quote.size !== singleBuySize || quote.cost === quotedCost) return quote;
  return { ...quote, cost: quotedCost };
}

function chooseQuotes<N, U extends string, Vars>(
  action: Action<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  params: GreedyStrategyParamsV1,
): QuoteChoice<N, U> {
  const mode = params.bulk?.mode ?? "bestQuote";
  const raw = action.bulk?.(ctx, state);
  const quotes = raw && raw.length > 0 ? stableBulkQuotes(raw) : [toFallbackQuote(action, ctx, state)];
  const none: QuoteChoice<N, U> = { selected: [], rejected: [] };

  if (mode === "size1") {
    const listed = Boolean(raw && raw.length > 0);
    let singleCost = quotes[0]!.cost;
    if (listed && quotes.some((quote) => quote.size === singleBuySize)) {
      singleCost = action.cost(ctx, state);
    }
    const preferred = quotes.find((quote) => quote.size === singleBuySize) ?? quotes[0]!;
    const accepted = rankableQuotes(ctx, state, [preferred], singleCost);
    if (accepted.length > 0) return { selected: accepted, rejected: [] };
    return { selected: [], rejected: [preferred] };
  }

  if (mode === "maxAffordable") {
    const cap = params.bulk?.maxSizeCap ?? Number.POSITIVE_INFINITY;
    const eligible: BulkQuote<N, U>[] = [];
    for (const quote of uniqueQuotedSizes(quotes)) {
      if (!Number.isInteger(quote.size) || quote.size < singleBuySize) continue;
      if (quote.size > cap) continue;
      const quotedCost = quote.size === singleBuySize ? action.cost(ctx, state) : quote.cost;
      if (!isAffordable(ctx, state, quotedCost)) continue;
      eligible.push(withActionCost(quote, quotedCost));
    }
    const largest = eligible[eligible.length - 1];
    if (!largest) return none;
    return { selected: [largest], rejected: [] };
  }

  const listed = Boolean(raw && raw.length > 0);
  let singleCost = quotes[0]!.cost;
  if (listed && quotes.some((quote) => quote.size === singleBuySize)) {
    singleCost = action.cost(ctx, state);
  }
  const rankable = rankableQuotes(ctx, state, quotes, singleCost);
  if (rankable.length > 0) return { selected: rankable, rejected: [] };
  return { selected: [], rejected: quotes };
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
  const settleable: Candidate<N, U, Vars>[] = [];
  const rejected: Candidate<N, U, Vars>[] = [];
  const raw = model.actions(ctx, state);
  const actions = stableActions(raw);

  for (const action of actions) {
    if (!action.canApply(ctx, state)) continue;
    const choice = chooseQuotes(action, ctx, state, params);
    const quotes = choice.selected.length > 0 ? choice.selected : choice.rejected;
    const bucket = choice.selected.length > 0 ? settleable : rejected;
    for (const quote of quotes) {
      const score = scoreQuote(params.objective, params, ctx, quote);
      if (!Number.isFinite(score)) continue;
      bucket.push({
        action,
        bulkSize: quotedDecisionSize(quote.size),
        occurrence: actionOccurrence(raw, action),
        score,
        equivCostLog10: quote.equivalentCost ? ctx.E.absLog10(quote.equivalentCost.amount) : undefined,
        costLog10: quote.cost ? ctx.E.absLog10(quote.cost.amount) : undefined,
      });
    }
  }

  // Invalid quotes stay available only when no action has a settleable one.
  const candidates = settleable.length > 0 ? settleable : rejected;

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
        occurrence: x.occurrence,
      }));
    },
  };
}
