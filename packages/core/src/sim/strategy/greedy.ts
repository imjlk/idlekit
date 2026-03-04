import type { Action, BulkQuote, Model, SimContext, SimState } from "../types";
import type { GreedyStrategyParamsV1 } from "./params";
import type { Strategy } from "./types";

export type GreedyObjective = GreedyStrategyParamsV1["objective"];

function bestQuote<N, U extends string>(
  action: Action<N, U, any>,
  ctx: SimContext<N, U, any>,
  state: SimState<N, U, any>,
): BulkQuote<N, U> {
  const quotes = action.bulk?.(ctx, state);
  if (!quotes || quotes.length === 0) {
    return {
      size: 1,
      cost: action.cost(ctx, state),
      equivalentCost: action.equivalentCost?.(ctx, state),
    };
  }

  return quotes.reduce((best, q) => {
    if (!best.deltaIncomePerSec) return q;
    if (!q.deltaIncomePerSec) return best;
    return ctx.E.cmp(q.deltaIncomePerSec.amount, best.deltaIncomePerSec.amount) > 0 ? q : best;
  });
}

function quoteScore<N, U extends string>(
  ctx: SimContext<N, U, any>,
  objective: GreedyObjective,
  q: BulkQuote<N, U>,
): number {
  if (objective === "maximizeIncome") {
    return q.deltaIncomePerSec ? ctx.E.toNumber(q.deltaIncomePerSec.amount) : Number.NEGATIVE_INFINITY;
  }

  if (objective === "minPayback") {
    const cost = q.equivalentCost?.amount ?? q.cost?.amount;
    const delta = q.deltaIncomePerSec?.amount;
    if (!cost || !delta) return Number.POSITIVE_INFINITY;
    const c = Math.abs(ctx.E.toNumber(cost));
    const d = Math.abs(ctx.E.toNumber(delta));
    if (d <= 0) return Number.POSITIVE_INFINITY;
    return c / d;
  }

  const worth = q.equivalentCost?.amount ?? q.cost?.amount;
  return worth ? ctx.E.toNumber(worth) : 0;
}

export function createGreedyStrategy<N, U extends string, Vars>(
  params: GreedyStrategyParamsV1,
): Strategy<N, U, Vars> {
  const objective = params.objective;
  const maxPicksPerStep = params.maxPicksPerStep ?? 1;

  return {
    id: "greedy",
    decide(ctx: SimContext<N, U, Vars>, model: Model<N, U, Vars>, state: SimState<N, U, Vars>) {
      const candidates = model.actions(ctx, state).filter((a) => a.canApply(ctx, state));
      if (candidates.length === 0) return [];

      let best: { action: Action<N, U, Vars>; bulkSize?: number; score: number } | null = null;

      for (const action of candidates) {
        const q = bestQuote(action, ctx, state);
        const raw = quoteScore(ctx, objective, q);
        const score = objective === "minPayback" ? -raw : raw;
        if (!Number.isFinite(score)) continue;
        if (!best || score > best.score) {
          best = {
            action,
            bulkSize: q.size > 1 ? q.size : undefined,
            score,
          };
        }
      }

      if (!best) return [];
      return [{ action: best.action, bulkSize: best.bulkSize }].slice(0, Math.max(1, maxPicksPerStep));
    },
  };
}
