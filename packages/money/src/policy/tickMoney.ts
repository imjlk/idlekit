import type { Engine } from "../engine/types";
import type { Money, MoneyState } from "../money/types";
import type { CoreOptions, MoneyEvent, TickPolicy, TickResult } from "./types";
import type { Emitter } from "./emitter";

function computeLogGap<N>(E: Engine<N>, base: N, delta: N): number {
  const zero = E.zero();
  if (E.cmp(base, zero) <= 0) return -Infinity;
  if (E.cmp(delta, zero) === 0) return Infinity;
  return E.absLog10(base) - E.absLog10(delta);
}

function isTooSmall<N>(E: Engine<N>, base: N, delta: N, maxLogGap?: number): boolean {
  if (maxLogGap === undefined) return false;
  const gap = computeLogGap(E, base, delta);
  return Number.isFinite(gap) && gap > maxLogGap;
}

export function tickMoney<N, U extends string>(args: {
  E: Engine<N>;
  state: MoneyState<N, U>;
  delta: Money<N, any>;
  policy: TickPolicy;
  emit?: Emitter<MoneyEvent<N>>;
  options?: CoreOptions;
}): TickResult<N, U> {
  const { E, state, delta, policy, emit } = args;
  const collectEvents = args.options?.collectEvents ?? true;
  const events: MoneyEvent<N>[] = [];

  if (state.money.unit.code !== delta.unit.code) {
    if (collectEvents) {
      events.push({
        type: "blocked",
        reason: "unitMismatch",
        baseUnit: state.money.unit.code,
        deltaUnit: delta.unit.code,
      });
    }

    const result: TickResult<N, U> = {
      status: "blocked",
      state,
      events,
    };

    if (collectEvents && emit) emit(events);
    return result;
  }

  const baseBefore = state.money.amount;
  const maxLogGap = policy.maxLogGap;

  if (policy.mode === "drop") {
    const logGap = computeLogGap(E, baseBefore, delta.amount);
    if (isTooSmall(E, baseBefore, delta.amount, maxLogGap)) {
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

  const bucketed = E.add(state.bucket, delta.amount);
  const logGap = computeLogGap(E, baseBefore, bucketed);

  if (isTooSmall(E, baseBefore, bucketed, maxLogGap)) {
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
