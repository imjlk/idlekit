import type { SimState } from "../../types";
import { deepClonePreservingPrototype } from "../../../utils/deepClone";

/** Fresh initial state for one tune or experiment candidate. The caller's state stays put. */
export function cloneCandidateInitial<N, U extends string, Vars>(state: SimState<N, U, Vars>): SimState<N, U, Vars> {
  return deepClonePreservingPrototype(state);
}
