import type { Action, Model, SimContext, SimState } from "../types";

/**
 * Strategy Contract (v0.1)
 *
 * - MUST be deterministic.
 * - MUST NOT mutate ctx/model/state (treat as immutable).
 * - Returned array order is execution order.
 * - Implementations should be stateless or re-creatable per run.
 *   (Avoid hidden mutable state; if necessary, ensure it's deterministic and not reused across runs.)
 */
export interface Strategy<N, U extends string, Vars> {
  id: string;
  // Optional strategy-state schema version used for persisted resume snapshots.
  stateVersion?: number;

  decide: (
    ctx: SimContext<N, U, Vars>,
    model: Model<N, U, Vars>,
    state: SimState<N, U, Vars>,
  ) => readonly Readonly<{ action: Action<N, U, Vars>; bulkSize?: number }>[];

  // Optional state hooks for deterministic resume/replay.
  snapshotState?: () => unknown;
  restoreState?: (state: unknown) => void;
}
