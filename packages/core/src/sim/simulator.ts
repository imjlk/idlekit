import { tickMoney } from "../policy/tickMoney";
import { analyzeUX, buildSimStats } from "./analysis/ux";
import type { CompiledScenario, RunResult, SimEvent, SimState } from "./types";

function updateMaxMoney<N, U extends string, Vars>(
  state: SimState<N, U, Vars>,
): SimState<N, U, Vars> {
  const { E } = state as unknown as { E?: never };
  void E;
  return state;
}

export function runScenario<N, U extends string, Vars>(
  sc: CompiledScenario<N, U, Vars>,
): RunResult<N, U, Vars> {
  const { E } = sc.ctx;
  let state = sc.initial;
  const start = sc.initial;

  const events: SimEvent<N>[] = [];
  const trace: SimState<N, U, Vars>[] = sc.run.trace ? [state] : [];
  const actionsLog: { t: number; actionId: string; label?: string; bulkSize?: number }[] = [];

  const stepSec = sc.run.stepSec;
  const durationSec = sc.run.durationSec;
  const maxActionsPerStep = sc.constraints?.maxActionsPerStep ?? Infinity;
  const everySteps = sc.run.trace?.everySteps ?? 1;

  const startT = state.t;
  let steps = 0;

  while (true) {
    if (durationSec !== undefined && state.t - startT >= durationSec) break;
    if (sc.run.until?.(state)) break;

    const prevForMilestone = state;

    const income = sc.model.income(sc.ctx, state);
    const moneyTick = tickMoney({
      E,
      state: state.wallet,
      delta: income,
      policy: sc.ctx.tickPolicy,
      options: {
        collectEvents: sc.ctx.collectMoneyEvents ?? !sc.run.fast?.disableMoneyEvents,
      },
    });

    state = {
      ...state,
      wallet: moneyTick.state,
    };

    if (moneyTick.events.length > 0) {
      const e: SimEvent<N> = { type: "money", events: moneyTick.events };
      events.push(e);
      sc.ctx.emit?.([e]);
    }

    if (sc.model.evolve) {
      state = sc.model.evolve(sc.ctx, state, stepSec);
    }

    const decisions = (sc.strategy?.decide(sc.ctx, sc.model, state) ?? []).slice(0, maxActionsPerStep);

    for (const d of decisions) {
      const action = d.action;

      if (!action.canApply(sc.ctx, state)) {
        const e: SimEvent<N> = {
          type: "action.skipped",
          actionId: action.id,
          reason: "cannotApply",
        };
        events.push(e);
        sc.ctx.emit?.([e]);
        continue;
      }

      const cost = action.cost(sc.ctx, state);
      if (cost) {
        if (state.wallet.money.unit.code !== cost.unit.code) {
          const e: SimEvent<N> = {
            type: "warning",
            code: "UNIT_MISMATCH_ON_COST",
            detail: { actionId: action.id, wallet: state.wallet.money.unit.code, cost: cost.unit.code },
          };
          events.push(e);
          sc.ctx.emit?.([e]);
          continue;
        }

        if (E.cmp(state.wallet.money.amount, cost.amount) < 0) {
          const behavior = sc.ctx.payment?.onInsufficientFunds ?? "skip";
          if (behavior === "throw") {
            throw new Error(`Insufficient funds for action ${action.id}`);
          }

          if (behavior === "warn") {
            const warn: SimEvent<N> = {
              type: "warning",
              code: "INSUFFICIENT_FUNDS",
              detail: { actionId: action.id },
            };
            events.push(warn);
            sc.ctx.emit?.([warn]);
          }

          const skipped: SimEvent<N> = {
            type: "action.skipped",
            actionId: action.id,
            reason: "insufficientFunds",
          };
          events.push(skipped);
          sc.ctx.emit?.([skipped]);
          continue;
        }

        state = {
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

      state = action.apply(sc.ctx, state, d.bulkSize);

      const applied: SimEvent<N> = {
        type: "action.applied",
        actionId: action.id,
        label: action.label,
        detail: d.bulkSize ? { bulkSize: d.bulkSize } : undefined,
      };
      events.push(applied);
      sc.ctx.emit?.([applied]);

      if (sc.run.trace?.keepActionsLog) {
        actionsLog.push({
          t: state.t,
          actionId: action.id,
          label: action.label,
          bulkSize: d.bulkSize,
        });
      }
    }

    const maybeMilestones = sc.model.milestones?.(sc.ctx, prevForMilestone, state) ?? [];
    for (const key of maybeMilestones) {
      const e: SimEvent<N> = { type: "milestone", key };
      events.push(e);
      sc.ctx.emit?.([e]);
    }

    if (E.cmp(state.wallet.money.amount, state.maxMoneyEver.amount) > 0) {
      state = {
        ...state,
        maxMoneyEver: state.wallet.money,
      };
    }

    state = {
      ...state,
      t: state.t + stepSec,
    };

    steps += 1;
    if (sc.run.trace && steps % everySteps === 0) {
      trace.push(state);
    }
  }

  const stats = buildSimStats(events);
  const uxFlags = analyzeUX(stats);

  return {
    start,
    end: state,
    events,
    trace: sc.run.trace ? trace : undefined,
    actionsLog: sc.run.trace?.keepActionsLog ? actionsLog : undefined,
    stats,
    uxFlags,
  };
}
