import type { Model, SimContext, SimState } from "../types";
import type { ResetAdapter } from "./resetCycle";

/*
 * Internal to reset analysis. Not exported from the package barrel.
 */

/**
 * The executor is the only reset authority. During an interval the strategy does not see the reset action,
 * so it cannot commit a reset the artifact would not count. Without an adapter, prestige actions are hidden.
 */
export function withoutResetActions<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  adapter: ResetAdapter<N, U, Vars> | undefined,
): Model<N, U, Vars> {
  const kind = adapter?.kind ?? "prestige";
  const actions = (actionCtx: SimContext<N, U, Vars>, actionState: SimState<N, U, Vars>) => {
    // Prestige actions are resets under any adapter. A custom adapter does not make them ordinary interval actions.
    const listed = model.actions(actionCtx, actionState).filter((candidate) => candidate.kind !== "prestige");
    if (kind === "prestige") return listed;
    // Resolve the custom reset for this state. Its id can change, or appear, as the interval earns resources.
    const reset = adapter?.action(actionCtx, actionState);
    if (!reset) return listed;
    // A listed reset is removed by identity, so an ordinary custom action sharing its id stays available.
    if (listed.includes(reset)) return listed.filter((candidate) => candidate !== reset);
    return listed.filter((candidate) => !(candidate.kind === "custom" && candidate.id === reset.id));
  };
  return delegateModel(model, actions);
}

/**
 * A plain object whose members read from, and call on, the original model. Methods keep the model as
 * their receiver, so class methods that use private fields still work.
 */
function delegateModel<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  actions: Model<N, U, Vars>["actions"],
): Model<N, U, Vars> {
  const out: Record<PropertyKey, unknown> = {};
  const seen = new Set<PropertyKey>();
  for (let level: object | null = model; level && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const key of Reflect.ownKeys(level)) {
      if (key === "constructor" || seen.has(key)) continue;
      seen.add(key);
      const value: unknown = Reflect.get(model, key, model);
      out[key] = typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(model) : value;
    }
  }
  out.actions = actions;
  return out as unknown as Model<N, U, Vars>;
}
