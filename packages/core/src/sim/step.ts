import type { Money } from "../money/types";
import type { Action, Model, ScenarioConstraints, SimContext, SimEvent, SimState } from "./types";

export type StepDecision<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
}>;

export type StepInput<N, U extends string, Vars> = Readonly<{
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;

  dt: number;

  decisions?: readonly StepDecision<N, U, Vars>[];

  constraints?: ScenarioConstraints;

  fast?: Readonly<{
    enabled: boolean;
    kind?: "log-domain";
    disableMoneyEvents?: boolean;
  }>;
}>;

export type StepOutput<N, U extends string, Vars> = Readonly<{
  prev: SimState<N, U, Vars>;
  next: SimState<N, U, Vars>;

  events: readonly SimEvent<N>[];

  actionsApplied?: readonly Readonly<{
    t: number;
    actionId: string;
    label?: string;
    bulkSize?: number;
  }>[];

  walletDelta?: Money<N, U>;
}>;

/**
 * Single source of truth for "one tick" transition.
 * - Applies decisions (auto payment via Action.cost) then apply()
 * - Applies income + evolve + tickMoney
 * - Emits events according to ctx.emit + collectMoneyEvents + fast flags
 */
export function stepOnce<N, U extends string, Vars>(
  _input: StepInput<N, U, Vars>,
): StepOutput<N, U, Vars> {
  throw new Error("stepOnce not implemented");
}
