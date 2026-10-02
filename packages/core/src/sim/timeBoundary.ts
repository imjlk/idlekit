import type { RunStop, RunStopReason, SimEvent, TimedSimEvent } from "./types";

/**
 * Dust scale for one stop check.
 * Epsilon is `max(1e-12, abs(limitSec) * timeBoundaryEpsilonScale)`.
 * Online and offline both use that limit, not a previously stored step.
 *
 * @evidence docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries The stop check uses this scale on the economic limit. A last tick is min(stepSec, time still inside that limit).
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #89f7aa9 Re-read the section: epsilon is max(1e-12, abs(limit) times this scale), and the limit is the economic horizon.
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
  clock: Readonly<{ stepSec: number; durationSec?: number; maxSteps?: number }>,
): void {
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
