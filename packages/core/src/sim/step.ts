import type { Money } from "../money/types";
import { tickMoney } from "../policy/tickMoney";
import type { Action, Model, ScenarioConstraints, SimContext, SimEvent, SimState } from "./types";

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
 * Single source of truth for "one tick" transition.
 * - Applies decisions (auto payment via Action.cost) then apply()
 * - Applies income + evolve + tickMoney
 * - Emits events according to ctx.emit + collectMoneyEvents + fast flags
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
    const action = d.action;
    if (!action.canApply(ctx, next)) {
      events.push({
        type: "action.skipped",
        actionId: action.id,
        reason: "cannotApply",
      });
      continue;
    }

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

    next = action.apply(ctx, next, d.bulkSize);
    events.push({
      type: "action.applied",
      actionId: action.id,
      label: action.label,
      detail: d.bulkSize ? { bulkSize: d.bulkSize } : undefined,
    });
    actionsApplied.push({
      t: next.t,
      actionId: action.id,
      label: action.label,
      bulkSize: d.bulkSize,
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
