import { deepClonePreservingPrototype } from "../utils/deepClone";
import type { RunGoal } from "./observation";
import type { SimState } from "./types";

// Goals made by shareGoalReads. Each maps a committed state to its first answer.
const answers = new WeakMap<object, WeakMap<object, boolean>>();

/**
 * Copies of `goals` that answer once per committed state. A session passes them to every
 * segment, so the segment recorder and the session stop read the same answer.
 */
export function shareGoalReads<N, U extends string, Vars>(goals: readonly RunGoal<N, U, Vars>[]): RunGoal<N, U, Vars>[] {
  return goals.map((goal) => {
    const shared: RunGoal<N, U, Vars> = { id: goal.id, met: (state) => goal.met(state) };
    answers.set(shared, new WeakMap());
    return shared;
  });
}

/** Each read gets its own copy of the state, so one predicate's write cannot reach the next. */
export function readGoal<N, U extends string, Vars>(goal: RunGoal<N, U, Vars>, state: SimState<N, U, Vars>): boolean {
  const memo = answers.get(goal);
  const known = memo?.get(state);
  if (known !== undefined) return known;
  const met = Boolean(goal.met(deepClonePreservingPrototype(state)));
  memo?.set(state, met);
  return met;
}
