import type { RunStop, RunStopReason, SimEvent, TimedSimEvent } from "./types";

/**
 * Dust scale for one stop check.
 * Epsilon is `max(1e-12, abs(limitSec) * timeBoundaryEpsilonScale)`.
 * Online and offline both use that limit, not a previously stored step.
 *
 * @evidence docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries The stop check uses this scale on the economic limit. A last tick is min(stepSec, time still inside that limit).
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #c6da01b Re-read the section: epsilon is max(1e-12, abs(limit) times this scale), and the limit is the economic horizon.
 */
export const timeBoundaryEpsilonScale = 1e-12;

export type BoundaryClock = Readonly<{
  /** Sum of tick dt. At a large state.t, `t - startT` cannot see a sub-ulp remainder and stalls. */
  elapsedSec: number;
  steps: number;
  stepSec: number;
  durationSec?: number;
  untilMet: boolean;
  hasUntil: boolean;
  maxSteps?: number;
}>;

export type BoundaryDecision =
  | Readonly<{ kind: "stop"; stop: RunStop }>
  | Readonly<{ kind: "guard" }>
  | Readonly<{ kind: "step"; dt: number }>;

export function timeEpsilon(limitSec: number): number {
  const magnitude = Math.abs(limitSec);
  const scaled = Number.isFinite(magnitude) ? magnitude * timeBoundaryEpsilonScale : 0;
  return Math.max(1e-12, scaled);
}

export function reachedLimit(elapsedSec: number, limitSec: number): boolean {
  return elapsedSec >= limitSec - timeEpsilon(limitSec);
}

function stopFor(reason: RunStopReason, clock: BoundaryClock): RunStop {
  return {
    reason,
    steps: clock.steps,
    elapsedSec: clock.elapsedSec,
    ...(clock.durationSec !== undefined ? { requestedDurationSec: clock.durationSec } : {}),
    ...(clock.maxSteps !== undefined ? { budgetSteps: clock.maxSteps } : {}),
  };
}

/**
 * Decide the next runner iteration before any economy transition.
 * A duration or until that is already true stops before the step budget.
 * The budget is a normal stop when a duration or until was requested.
 * With neither, it is only a guard: the runner throws and does not return a run.
 */
export function nextBoundary(clock: BoundaryClock): BoundaryDecision {
  if (clock.durationSec !== undefined && reachedLimit(clock.elapsedSec, clock.durationSec)) {
    return { kind: "stop", stop: stopFor("duration", clock) };
  }
  if (clock.untilMet) {
    return { kind: "stop", stop: stopFor("until", clock) };
  }
  if (clock.maxSteps !== undefined && clock.steps >= clock.maxSteps) {
    if (clock.durationSec === undefined && !clock.hasUntil) return { kind: "guard" };
    return { kind: "stop", stop: stopFor("budget", clock) };
  }
  const remaining = clock.durationSec === undefined ? undefined : clock.durationSec - clock.elapsedSec;
  const dt = remaining === undefined ? clock.stepSec : Math.min(clock.stepSec, remaining);
  return { kind: "step", dt };
}

export function assertSimulationClock(
  label: string,
  clock: Readonly<{ stepSec: number; durationSec?: number; maxSteps?: number; startT?: unknown }>,
): void {
  // Checked before the first stop decision, so a run that never ticks cannot return a bad start time.
  if ("startT" in clock && (typeof clock.startT !== "number" || !Number.isFinite(clock.startT))) {
    throw new Error(`${label} state.t must be a finite number (start t: ${String(clock.startT)})`);
  }
  if (!Number.isFinite(clock.stepSec) || !(clock.stepSec > 0)) {
    throw new Error(`${label} stepSec must be a finite number > 0 (received: ${clock.stepSec})`);
  }
  if (
    clock.durationSec !== undefined &&
    (!Number.isFinite(clock.durationSec) || clock.durationSec < 0)
  ) {
    throw new Error(
      `${label} durationSec must be a finite number >= 0 (received: ${clock.durationSec})`,
    );
  }
  if (
    clock.maxSteps !== undefined &&
    (!Number.isFinite(clock.maxSteps) || !Number.isInteger(clock.maxSteps) || clock.maxSteps < 0)
  ) {
    throw new Error(
      `${label} maxSteps must be a finite integer >= 0 (received: ${clock.maxSteps})`,
    );
  }
}

/**
 * A committed tick must move a finite state.t, or `end.t - start.t` and event times freeze while income is paid.
 * A last partial tick below half an ulp of t may leave t alone when a whole step still moves it and an
 * earlier tick of the run already moved t past `runStartT`.
 */
export function assertTickAdvanced(
  label: string,
  t0: number,
  t1: number,
  dt: number,
  stepSec: number,
  runStartT: number,
): void {
  // A string t would concatenate and still compare as larger.
  if (typeof t0 !== "number" || !Number.isFinite(t0) || typeof t1 !== "number" || !Number.isFinite(t1)) {
    throw new Error(`${label} state.t must be a finite number (start t: ${String(t0)}, committed t: ${String(t1)})`);
  }
  if (t1 > t0) return;
  if (dt < stepSec && t0 > runStartT && t0 + dt === t0 && t0 + stepSec > t0) return;
  throw new Error(
    `${label} tick did not advance state.t (start t: ${t0}, step: ${dt}, committed t: ${t1}); state.t is too large for stepSec ${stepSec}`,
  );
}

/** Copy. The caller's context object is not written. `stepSec` is this tick's dt. */
export function stepContext<C extends { stepSec?: number }>(ctx: C, dt: number): C {
  return { ...ctx, stepSec: dt };
}

export function timeStepEvents<N>(
  events: readonly SimEvent<N>[],
  actionStartT: number,
  incomeEndT: number,
): TimedSimEvent<N>[] {
  return events.map((event) => {
    const phase = event.type === "money" || event.type === "milestone" ? "income-end" : "action-start";
    return {
      t: phase === "income-end" ? incomeEndT : actionStartT,
      event,
      phase,
    };
  });
}
