import { deepClonePreservingPrototype } from "../utils/deepClone";
import type { RunGoal } from "./observation";
import type { SimRunOptions, SimState } from "./types";

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

/** Milestone keys and goal samples one recorder has seen. Recorders that share it count as one. */
export type ObservationLedger = {
  readonly seenMilestones: Set<string>;
  retainedMilestones: number;
  retainedGoals: number;
  readonly droppedGoals: Set<string>;
};

export function createObservationLedger(): ObservationLedger {
  return { seenMilestones: new Set(), retainedMilestones: 0, retainedGoals: 0, droppedGoals: new Set() };
}

type ObservationOptions = NonNullable<SimRunOptions["observation"]>;

// Observation options made by shareObservation. Each maps to the ledger its recorders share.
const ledgers = new WeakMap<object, ObservationLedger>();

/**
 * A copy of `observation` whose recorders share one ledger. A session passes it to every segment,
 * so the caller's caps, drops, and observer notifications cover the session, not each segment.
 */
export function shareObservation(observation: SimRunOptions["observation"]): Readonly<{
  observation: ObservationOptions;
  ledger: ObservationLedger;
}> {
  const shared: ObservationOptions = { ...observation };
  const ledger = createObservationLedger();
  ledgers.set(shared, ledger);
  return { observation: shared, ledger };
}

export function observationLedger(observation: SimRunOptions["observation"]): ObservationLedger | undefined {
  return observation ? ledgers.get(observation) : undefined;
}
