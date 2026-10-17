import type { OfflinePolicy } from "../scenario/offlinePolicy";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import type { CompiledScenario, Model, SimContext, SimState } from "./types";

/** A segment credit policy. The session's action policy remains in scenario.run.offline.actions. */
export type SessionOfflineCreditPolicy = Omit<OfflinePolicy, "actions">;

export type SessionOfflinePreparation<N, U extends string, Vars> = Readonly<{
  /** Omitted keeps the active model. A replacement is used only for this absence. */
  model?: Model<N, U, Vars>;
  /** Omitted keeps the scenario's step. One atomic game settlement may use one effective-reward tick. */
  stepSec?: number;
  /** Replaces cap/decay for this gap. Omitted keeps the scenario policy; {} removes cap/decay. */
  policy?: SessionOfflineCreditPolicy;
}>;

/**
 * Called once per nonempty absence, before its reward ticks. State and policy are isolated snapshots;
 * numeric prototypes are retained. Treat the shared engine, model and context as immutable.
 * Wall timestamps are explicit even if the model does not declare clocks.respondsTo.
 * The returned model still runs through ordinary offline ticks, goals, observations and action filtering.
 */
export type SessionOfflinePreparer<N, U extends string, Vars> = (args: Readonly<{
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;
  seconds: number;
  wallStartT: number;
  wallEndT: number;
  policy?: OfflinePolicy;
}>) => SessionOfflinePreparation<N, U, Vars>;

function validateCreditPolicy(policy: SessionOfflineCreditPolicy): void {
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || "actions" in policy) {
    throw new RangeError("prepareOffline policy must be a credit policy; set actions on scenario.run.offline");
  }
  if (policy.maxSec !== undefined && (typeof policy.maxSec !== "number" || !Number.isFinite(policy.maxSec) || policy.maxSec < 0)) {
    throw new RangeError("prepareOffline policy.maxSec must be finite and nonnegative");
  }
  if (policy.overflowPolicy !== undefined && policy.overflowPolicy !== "clamp" && policy.overflowPolicy !== "reject") {
    throw new RangeError("prepareOffline policy.overflowPolicy must be clamp or reject");
  }
  const decay = policy.decay;
  if (decay !== undefined) {
    if (!decay || typeof decay !== "object" || Array.isArray(decay) || (decay.kind !== "none" && decay.kind !== "linear")) {
      throw new RangeError("prepareOffline policy.decay must select none or linear");
    }
    if (decay.floorRatio !== undefined && (typeof decay.floorRatio !== "number" || !Number.isFinite(decay.floorRatio) || decay.floorRatio < 0 || decay.floorRatio > 1)) {
      throw new RangeError("prepareOffline policy.decay.floorRatio must be finite and in 0..1");
    }
  }
}

/** Internal preparation boundary; it does not execute or replace an offline run. */
export function prepareOfflineSegment<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  state: SimState<N, U, Vars>;
  seconds: number;
  wallStartT: number;
  wallEndT: number;
  prepare?: SessionOfflinePreparer<N, U, Vars>;
}): Readonly<{ model: Model<N, U, Vars>; policy: OfflinePolicy | undefined; stepSec: number }> {
  const { scenario, prepare } = args;
  if (!prepare) return { model: scenario.model, policy: scenario.run.offline, stepSec: scenario.run.stepSec };
  const prepared = prepare({
    ctx: scenario.ctx, model: scenario.model,
    state: deepClonePreservingPrototype(args.state),
    seconds: args.seconds, wallStartT: args.wallStartT, wallEndT: args.wallEndT,
    ...(scenario.run.offline ? { policy: deepClonePreservingPrototype(scenario.run.offline) } : {}),
  });
  if (!prepared || typeof prepared !== "object" || Array.isArray(prepared) || "then" in prepared) {
    throw new RangeError("prepareOffline must synchronously return a preparation object");
  }
  if (prepared.stepSec !== undefined && (typeof prepared.stepSec !== "number" || !Number.isFinite(prepared.stepSec) || prepared.stepSec <= 0)) {
    throw new RangeError("prepareOffline stepSec must be finite and positive");
  }
  if (prepared.policy !== undefined) validateCreditPolicy(prepared.policy);
  const model = prepared.model === undefined ? scenario.model : prepared.model;
  if (!model || typeof model !== "object" || typeof model.income !== "function" || typeof model.actions !== "function") {
    throw new RangeError("prepareOffline model must provide income and actions");
  }
  return {
    model,
    stepSec: prepared.stepSec ?? scenario.run.stepSec,
    policy: prepared.policy === undefined ? scenario.run.offline : {
      ...deepClonePreservingPrototype(prepared.policy), actions: scenario.run.offline?.actions,
    },
  };
}
