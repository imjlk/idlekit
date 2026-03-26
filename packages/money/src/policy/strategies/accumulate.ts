import type { Engine } from "../../engine/types";
import type { Money, MoneyState } from "../../money/types";
import type { Emitter } from "../emitter";
import type { MoneyEvent, TickPolicy, TickResult } from "../types";
import { computeLogGap, isTooSmall } from "./shared";

export function applyAccumulatePolicy<N, U extends string>(args: {
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
  const bucketed = E.add(state.bucket, delta.amount);
  const logGap = computeLogGap(E, baseBefore, bucketed);

  if (isTooSmall(E, baseBefore, bucketed, policy.maxLogGap)) {
    const nextState: MoneyState<N, U> = {
      money: state.money,
      bucket: bucketed,
    };

    if (collectEvents) {
      events.push({
        type: "queued",
        base: baseBefore,
        delta: delta.amount,
        bucketAfter: bucketed,
        logGap,
        reason: "tooSmall",
      });
    }

    const result: TickResult<N, U> = { status: "ok", state: nextState, events };
    if (collectEvents && emit) emit(events);
    return result;
  }

  const baseAfter = E.add(baseBefore, bucketed);
  const nextState: MoneyState<N, U> = {
    money: {
      unit: state.money.unit,
      amount: baseAfter,
    },
    bucket: E.zero(),
  };

  if (collectEvents) {
    if (E.cmp(state.bucket, E.zero()) !== 0) {
      events.push({
        type: "flushed",
        baseBefore,
        baseAfter,
        bucketFlushed: state.bucket,
        reason: "becameSignificant",
      });
    }

    events.push({
      type: "applied",
      baseBefore,
      baseAfter,
      delta: bucketed,
      logGap: Number.isFinite(logGap) ? logGap : undefined,
    });
  }

  const result: TickResult<N, U> = { status: "ok", state: nextState, events };
  if (collectEvents && emit) emit(events);
  return result;
}
