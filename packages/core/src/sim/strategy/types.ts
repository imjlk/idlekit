import type { Action, Model, SimContext, SimState } from "../types";

export interface Strategy<N, U extends string, Vars> {
  id: string;

  decide: (
    ctx: SimContext<N, U, Vars>,
    model: Model<N, U, Vars>,
    state: SimState<N, U, Vars>,
  ) => readonly Readonly<{ action: Action<N, U, Vars>; bulkSize?: number }>[];
}
