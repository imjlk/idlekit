import type { Action, BulkQuote } from "../types";

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
