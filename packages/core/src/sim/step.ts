import type { Money } from "../money/types";
import { tickMoney } from "../policy/tickMoney";
import type { Action, BulkQuote, Model, ScenarioConstraints, SimContext, SimEvent, SimState } from "./types";

export type StepDecision<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
}>;

export type StepInput<N, U extends string, Vars> = Readonly<{
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;

  dt: number;

  decisions?: readonly StepDecision<N, U, Vars>[];

  constraints?: ScenarioConstraints;

  fast?: Readonly<{
    enabled: boolean;
    kind?: "log-domain";
    disableMoneyEvents?: boolean;
  }>;
}>;

export type StepOutput<N, U extends string, Vars> = Readonly<{
  prev: SimState<N, U, Vars>;
  next: SimState<N, U, Vars>;

  events: readonly SimEvent<N>[];

  actionsApplied?: readonly Readonly<{
    t: number;
    actionId: string;
    label?: string;
    bulkSize?: number;
  }>[];

  walletDelta?: Money<N, U>;
}>;

/**
 * Buy size that still pays `Action.cost`.
 * A larger integer size pays one matching `BulkQuote` instead.
 *
 * @evidence docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement Size 1 stays on Action.cost. bulkSize greater than this constant is a quoted bulk buy.
 * @evidenceReview docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement #f2fb3d7 Re-read the section: omitted and size 1 pay Action.cost, and a larger integer pays the matching quote.
 */
export const singleBuySize = 1;

function currentAction<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  selected: Action<N, U, Vars>,
): Action<N, U, Vars> {
  const match = model.actions(ctx, state).find((candidate) => candidate.id === selected.id);
  return match ?? selected;
}

function rejectBulk<N>(events: SimEvent<N>[], actionId: string, code: string, detail: unknown): void {
  events.push({ type: "warning", code, detail });
  events.push({ type: "action.skipped", actionId, reason: "invalidQuote" });
}

function isQuotedBulkSize(size: number): boolean {
  return Number.isInteger(size) && size > singleBuySize;
}

function matchingQuotes<N, U extends string>(
  quotes: readonly BulkQuote<N, U>[],
  size: number,
): BulkQuote<N, U>[] {
  const matched: BulkQuote<N, U>[] = [];
  for (const quote of quotes) {
    if (quote && quote.size === size) matched.push(quote);
  }
  return matched;
}

function isQuoteList<N, U extends string>(
  value: readonly BulkQuote<N, U>[] | undefined,
): value is readonly BulkQuote<N, U>[] {
  return Array.isArray(value);
}

function payQuote<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  actionId: string,
  cost: Money<N, U> | null | undefined,
  events: SimEvent<N>[],
): SimState<N, U, Vars> | undefined {
  if (cost == null) {
    if (cost === null) return state;
    rejectBulk(events, actionId, "INVALID_BULK_COST", { actionId, reason: "missingCost" });
    return undefined;
  }
  if (state.wallet.money.unit.code !== cost.unit.code) {
    rejectBulk(events, actionId, "UNIT_MISMATCH_ON_COST", {
      actionId,
      wallet: state.wallet.money.unit.code,
      cost: cost.unit.code,
    });
    return undefined;
  }
  const { E } = ctx;
  if (!E.isFinite(cost.amount) || E.cmp(cost.amount, E.zero()) < 0) {
    rejectBulk(events, actionId, "INVALID_BULK_COST", { actionId });
    return undefined;
  }
  if (E.cmp(state.wallet.money.amount, cost.amount) < 0) {
    const behavior = ctx.payment?.onInsufficientFunds ?? "skip";
    if (behavior === "throw") {
      throw new Error(`Insufficient funds for action ${actionId}`);
    }
    if (behavior === "warn") {
      events.push({
        type: "warning",
        code: "INSUFFICIENT_FUNDS",
        detail: { actionId },
      });
    }
    events.push({
      type: "action.skipped",
      actionId,
      reason: "insufficientFunds",
    });
    return undefined;
  }
  return {
    ...state,
    wallet: {
      ...state.wallet,
      money: {
        ...state.wallet.money,
        amount: E.sub(state.wallet.money.amount, cost.amount),
      },
    },
  };
}

function settleBulk<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  action: Action<N, U, Vars>,
  state: SimState<N, U, Vars>,
  size: number,
  events: SimEvent<N>[],
): SimState<N, U, Vars> | undefined {
  if (typeof size !== "number" || !isQuotedBulkSize(size)) {
    rejectBulk(events, action.id, "INVALID_BULK_SIZE", { actionId: action.id, size });
    return undefined;
  }
  const raw = action.bulk?.(ctx, state);
  if (!isQuoteList(raw)) {
    rejectBulk(events, action.id, "MISSING_BULK_QUOTE", { actionId: action.id, size });
    return undefined;
  }
  const matched = matchingQuotes(raw, size);
  if (matched.length === 0) {
    rejectBulk(events, action.id, "MISSING_BULK_QUOTE", { actionId: action.id, size });
    return undefined;
  }
  if (matched.length > 1) {
    rejectBulk(events, action.id, "AMBIGUOUS_BULK_QUOTE", { actionId: action.id, size });
    return undefined;
  }
  const quote = matched[0];
  if (!quote) return undefined;
  return payQuote(ctx, state, action.id, quote.cost, events);
}

/**
 * Single source of truth for one tick.
 * An omitted size or `singleBuySize` pays `Action.cost` once, then `apply` once.
 * A larger integer size pays the matching `BulkQuote.cost` once, then `apply` once.
 * `apply` does not pay again. A rejected quote leaves this state unchanged.
 * Each decision re-reads `model.actions` for the state so far, so a later buy is quoted after earlier applies.
 * Plugin callbacks are not a transaction.
 *
 * @evidence docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement Pays the current matching BulkQuote once for a quoted bulk size and keeps the single-cost path for size 1.
 * @evidenceReview docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement #f2fb3d7 Re-read the section: size 10 pays the quote total, a missing quote does not fall back to the unit cost, and a failed check does not change wallet or vars.
 */
export function stepOnce<N, U extends string, Vars>(
  input: StepInput<N, U, Vars>,
): StepOutput<N, U, Vars> {
  const { ctx, model, dt, constraints, fast } = input;
  const prev = input.state;
  const { E } = ctx;

  let next = prev;
  const events: SimEvent<N>[] = [];
  const actionsApplied: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }> = [];

  const maxActionsPerStep = constraints?.maxActionsPerStep ?? Number.POSITIVE_INFINITY;
  const decisions = (input.decisions ?? []).slice(0, Math.max(0, maxActionsPerStep));

  for (const d of decisions) {
    const action = currentAction(model, ctx, next, d.action);
    if (!action.canApply(ctx, next)) {
      events.push({
        type: "action.skipped",
        actionId: action.id,
        reason: "cannotApply",
      });
      continue;
    }

    let settledSize = d.bulkSize;
    if (d.bulkSize !== undefined && d.bulkSize !== singleBuySize) {
      const settled = settleBulk(ctx, action, next, d.bulkSize, events);
      if (!settled) continue;
      next = settled;
      settledSize = d.bulkSize;
    } else {
      const cost = action.cost(ctx, next);
      if (cost) {
        if (next.wallet.money.unit.code !== cost.unit.code) {
          events.push({
            type: "warning",
            code: "UNIT_MISMATCH_ON_COST",
            detail: {
              actionId: action.id,
              wallet: next.wallet.money.unit.code,
              cost: cost.unit.code,
            },
          });
          continue;
        }

        if (E.cmp(next.wallet.money.amount, cost.amount) < 0) {
          const behavior = ctx.payment?.onInsufficientFunds ?? "skip";
          if (behavior === "throw") {
            throw new Error(`Insufficient funds for action ${action.id}`);
          }
          if (behavior === "warn") {
            events.push({
              type: "warning",
              code: "INSUFFICIENT_FUNDS",
              detail: { actionId: action.id },
            });
          }
          events.push({
            type: "action.skipped",
            actionId: action.id,
            reason: "insufficientFunds",
          });
          continue;
        }

        next = {
          ...next,
          wallet: {
            ...next.wallet,
            money: {
              ...next.wallet.money,
              amount: E.sub(next.wallet.money.amount, cost.amount),
            },
          },
        };
      }
    }

    next = action.apply(ctx, next, settledSize);
    events.push({
      type: "action.applied",
      actionId: action.id,
      label: action.label,
      detail: settledSize ? { bulkSize: settledSize } : undefined,
    });
    actionsApplied.push({
      t: next.t,
      actionId: action.id,
      label: action.label,
      bulkSize: settledSize,
    });
  }

  const income = model.income(ctx, next);
  const scaledIncome = {
    ...income,
    amount: E.mul(income.amount, dt),
  };
  const moneyTick = tickMoney({
    E,
    state: next.wallet,
    delta: scaledIncome,
    policy: ctx.tickPolicy,
    options: {
      collectEvents: ctx.collectMoneyEvents ?? !fast?.disableMoneyEvents,
    },
  });

  next = {
    ...next,
    wallet: moneyTick.state,
  };

  if (moneyTick.events.length > 0) {
    events.push({ type: "money", events: moneyTick.events });
  }

  if (model.evolve) {
    next = model.evolve(ctx, next, dt);
  }

  const milestones = model.milestones?.(ctx, prev, next) ?? [];
  for (const key of milestones) {
    events.push({ type: "milestone", key });
  }

  if (E.cmp(next.wallet.money.amount, next.maxMoneyEver.amount) > 0) {
    next = {
      ...next,
      maxMoneyEver: next.wallet.money,
    };
  }

  next = {
    ...next,
    t: next.t + dt,
  };

  if (events.length > 0 && ctx.emit) {
    ctx.emit(events);
  }

  const walletDelta: Money<N, U> = {
    unit: next.wallet.money.unit,
    amount: E.sub(next.wallet.money.amount, prev.wallet.money.amount),
  };

  return {
    prev,
    next,
    events,
    actionsApplied: actionsApplied.length > 0 ? actionsApplied : undefined,
    walletDelta,
  };
}
