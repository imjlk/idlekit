import type { Engine } from "../engine/types";
import type { Money, MoneyState } from "../money/types";
import type { CoreOptions, MoneyEvent, TickPolicy, TickResult } from "./types";
import type { Emitter } from "./emitter";
import { applyAccumulatePolicy } from "./strategies/accumulate";
import { applyDropPolicy } from "./strategies/drop";

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

  return policy.mode === "drop"
    ? applyDropPolicy({ E, state, delta, policy, emit, collectEvents })
    : applyAccumulatePolicy({ E, state, delta, policy, emit, collectEvents });
}
