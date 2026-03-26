import type { Engine } from "../../engine/types";
import type { Money, MoneyState } from "../../money/types";
import type { Emitter } from "../emitter";
import type { MoneyEvent, TickPolicy, TickResult } from "../types";
import { computeLogGap, isTooSmall } from "./shared";

export function applyDropPolicy<N, U extends string>(args: {
  E: Engine<N>;
  state: MoneyState<N, U>;
  delta: Money<N, any>;
  policy: TickPolicy;
  emit?: Emitter<MoneyEvent<N>>;
  collectEvents: boolean;
}): TickResult<N, U> {
  const { E, state, delta, policy, emit, collectEvents } = args;
  const events: MoneyEvent<N>[] = [];
  const baseBefore = state.money.amount;
  const logGap = computeLogGap(E, baseBefore, delta.amount);

  if (isTooSmall(E, baseBefore, delta.amount, policy.maxLogGap)) {
    if (collectEvents) {
      events.push({
        type: "dropped",
        base: baseBefore,
        delta: delta.amount,
        logGap,
        reason: "tooSmall",
      });
    }
    const result: TickResult<N, U> = { status: "ok", state, events };
    if (collectEvents && emit) emit(events);
    return result;
  }

  const baseAfter = E.add(baseBefore, delta.amount);
  const nextState: MoneyState<N, U> = {
    money: {
      unit: state.money.unit,
      amount: baseAfter,
    },
    bucket: E.zero(),
  };

  if (collectEvents) {
    events.push({
      type: "applied",
      baseBefore,
      baseAfter,
      delta: delta.amount,
      logGap: Number.isFinite(logGap) ? logGap : undefined,
    });
  }

  const result: TickResult<N, U> = { status: "ok", state: nextState, events };
  if (collectEvents && emit) emit(events);
  return result;
}
