import type { Engine } from "../../engine/types";
import type { Money, MoneyState } from "../../money/types";
import type { Emitter } from "../emitter";
import type { MoneyEvent, TickPolicy, TickResult } from "../types";
import { computeLogGap, isTooSmall } from "./shared";
import { APPLIED_FACTS, FLUSHED_FACTS, QUEUED_FACTS } from "../facts";

export function applyAccumulatePolicy<N, U extends string>(args: {
  E: Engine<N>;
  state: MoneyState<N, U>;
  delta: Money<N, any>;
  policy: TickPolicy;
  emit?: Emitter<MoneyEvent<N>>;
  collectEvents: boolean;
  collectFacts?: boolean;
}): TickResult<N, U> {
  const { E, state, delta, policy, emit, collectEvents, collectFacts } = args;
  const events: MoneyEvent<N>[] = [];
  const baseBefore = state.money.amount;
  const bucketed = E.add(state.bucket, delta.amount);
  const logGap = computeLogGap(E, baseBefore, bucketed);

  if (isTooSmall(E, baseBefore, bucketed, policy.maxLogGap, logGap)) {
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

    const result: TickResult<N, U> = collectFacts
      ? { status: "ok", state: nextState, events, facts: QUEUED_FACTS }
      : { status: "ok", state: nextState, events };
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

  const flushed = (collectEvents || collectFacts) && E.cmp(state.bucket, E.zero()) !== 0;
  if (collectEvents) {
    if (flushed) {
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

  const result: TickResult<N, U> = collectFacts
    ? (flushed
      ? { status: "ok", state: nextState, events, facts: FLUSHED_FACTS, appliedDelta: bucketed, flushedBucket: state.bucket }
      : { status: "ok", state: nextState, events, facts: APPLIED_FACTS, appliedDelta: bucketed })
    : { status: "ok", state: nextState, events };
  if (collectEvents && emit) emit(events);
  return result;
}
