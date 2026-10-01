import { canSettleCost, singleBuySize } from "../step";
import type { Action, BulkQuote, SimContext, SimState } from "../types";

/** A quote `stepOnce` would skip as `invalidQuote` cannot be the ranked candidate. */
export function settlementAcceptsQuote<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  quote: BulkQuote<N, U>,
): boolean {
  if (!Number.isInteger(quote.size) || quote.size < singleBuySize) return false;
  if (quote.size === singleBuySize) return true;
  const cost = quote.cost;
  if (cost === null) return true;
  if (!cost || cost.unit.code !== state.wallet.money.unit.code) return false;
  if (cost.amount == null || !ctx.E.isFinite(cost.amount)) return false;
  return canSettleCost(ctx.E, cost.amount, ctx.E.zero());
}

/** Drop settlement-invalid quotes, including two bulk quotes that share one size. */
export function rankableQuotes<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  quotes: readonly BulkQuote<N, U>[],
): BulkQuote<N, U>[] {
  const accepted = quotes.filter((quote) => settlementAcceptsQuote(ctx, state, quote));
  const counts = new Map<number, number>();
  for (const quote of accepted) {
    if (quote.size === singleBuySize) continue;
    counts.set(quote.size, (counts.get(quote.size) ?? 0) + 1);
  }
  return accepted.filter((quote) => quote.size === singleBuySize || counts.get(quote.size) === 1);
}

/** Size 1 pays `Action.cost`. A missing size stays rejectable. Every other selected size is settled as a quote. */
export function quotedDecisionSize(size: number | undefined): number | undefined {
  if (typeof size !== "number") return Number.NaN;
  return size === singleBuySize ? undefined : size;
}

/** How many earlier actions share `selected`'s id and kind. The list order is the caller's selection order. */
export function actionOccurrence<N, U extends string, Vars>(
  actions: readonly Action<N, U, Vars>[],
  selected: Action<N, U, Vars>,
): number {
  let occurrence = 0;
  for (const action of actions) {
    if (action === selected) return occurrence;
    if (action.id === selected.id && action.kind === selected.kind) occurrence += 1;
  }
  return occurrence;
}

/**
 * Stabilize Action ordering for deterministic strategy/planner.
 * Sort by action.id (lexicographic), then kind.
 */
export function stableActions<N, U extends string, Vars>(
  actions: readonly Action<N, U, Vars>[],
): readonly Action<N, U, Vars>[] {
  return [...actions].sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return 0;
  });
}

/**
 * Stabilize BulkQuote ordering for deterministic bulk selection.
 * Sort by size ASC, then cost presence (cost!=null first), then keep relative order.
 */
export function stableBulkQuotes<N, U extends string>(
  quotes: readonly BulkQuote<N, U>[],
): readonly BulkQuote<N, U>[] {
  return [...quotes].sort((a, b) => {
    if (a.size !== b.size) return a.size - b.size;
    const ac = a.cost ? 0 : 1;
    const bc = b.cost ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return 0;
  });
}

/**
 * Stable tie-break key for candidates (greedy/planner).
 */
export type CandidateKey = Readonly<{
  score: number;
  equivCostLog10?: number;
  costLog10?: number;
  actionId: string;
  bulkSize?: number;
}>;

export function compareCandidateKey(a: CandidateKey, b: CandidateKey): -1 | 0 | 1 {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;

  const ae = a.equivCostLog10 ?? Infinity;
  const be = b.equivCostLog10 ?? Infinity;
  if (ae !== be) return ae < be ? -1 : 1;

  const ac = a.costLog10 ?? Infinity;
  const bc = b.costLog10 ?? Infinity;
  if (ac !== bc) return ac < bc ? -1 : 1;

  if (a.actionId !== b.actionId) return a.actionId < b.actionId ? -1 : 1;

  const ab = a.bulkSize ?? 1;
  const bb = b.bulkSize ?? 1;
  if (ab !== bb) return ab < bb ? -1 : 1;

  return 0;
}
