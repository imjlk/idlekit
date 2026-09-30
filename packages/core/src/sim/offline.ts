import { analyzeUX, createSimStatsAccumulator } from "./analysis/ux";
import { createEventBuffer } from "./eventBuffer";
import { stepOnce } from "./step";
import { assertSimulationClock, nextBoundary, stepContext, timeEpsilon, timeStepEvents } from "./timeBoundary";
import type { CompiledScenario, RunResult, RunStop, SimState } from "./types";

export type OfflineRunOptions<N, U extends string, Vars> = Readonly<{
  fromState?: SimState<N, U, Vars>;
  stepSec?: number;
  useStrategy?: boolean;
  maxSteps?: number;
  fast?: CompiledScenario<N, U, Vars>["run"]["fast"];
  eventLog?: CompiledScenario<N, U, Vars>["run"]["eventLog"];
  policy?: CompiledScenario<N, U, Vars>["run"]["offline"];
}>;

export type OfflineRunResult<N, U extends string, Vars> = Readonly<
  RunResult<N, U, Vars> & {
    offline: Readonly<{
      requestedSec: number;
      preDecaySec: number;
      effectiveSec: number;
      simulatedSec: number;
      stepSec: number;
      fullSteps: number;
      remainderSec: number;
      usedStrategy: boolean;
      overflow: "none" | "clamped";
      decay: Readonly<{
        kind: "none" | "linear";
        ratio: number;
      }>;
    }>;
  }
>;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function resolveOfflineSeconds(
  requestedSec: number,
  policy: CompiledScenario<any, any, any>["run"]["offline"] | undefined,
): Readonly<{
  preDecaySec: number;
  effectiveSec: number;
  overflow: "none" | "clamped";
  decayKind: "none" | "linear";
  decayRatio: number;
}> {
  const maxSec = policy?.maxSec;
  const overflowPolicy = policy?.overflowPolicy ?? "clamp";

  let preDecaySec = requestedSec;
  let overflow: "none" | "clamped" = "none";

  if (maxSec !== undefined && requestedSec > maxSec) {
    if (overflowPolicy === "reject") {
      throw new Error(`offline seconds exceed policy maxSec (${maxSec})`);
    }
    preDecaySec = maxSec;
    overflow = "clamped";
  }

  const decayKind = policy?.decay?.kind ?? "none";
  const floorRatio = clamp01(policy?.decay?.floorRatio ?? 0.25);

  let decayRatio = 1;
  if (decayKind === "linear" && maxSec !== undefined && maxSec > 0) {
    const progress = clamp01(preDecaySec / maxSec);
    // 0 sec => ratio 1, maxSec => floorRatio
    decayRatio = floorRatio + (1 - floorRatio) * (1 - progress);
  }

  return {
    preDecaySec,
    effectiveSec: preDecaySec * decayRatio,
    overflow,
    decayKind,
    decayRatio,
  };
}

/**
 * Catch up `effectiveSec` with the same partial-tick and budget rules as `runScenario`.
 * A short `maxSteps` stops with reason `budget` instead of throwing the completed time away.
 * `stepOnce` is still the only economy transition.
 *
 * @evidence docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries Applies the same horizon, partial tick, and step budget as the online runner.
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #89f7aa9 Re-read the section: offline uses that partial tick, and a short maxSteps returns budget instead of discarding the run.
 */
export function applyOfflineSeconds<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  seconds: number;
  options?: OfflineRunOptions<N, U, Vars>;
}): OfflineRunResult<N, U, Vars> {
  const { scenario, seconds } = args;
  const opts = args.options;

  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`offline seconds must be a finite number >= 0 (received: ${seconds})`);
  }

  const stepSec = opts?.stepSec ?? scenario.run.stepSec;
  const maxSteps = opts?.maxSteps;
  assertSimulationClock("offline", { stepSec, maxSteps });

  const useStrategy = opts?.useStrategy ?? !!scenario.strategy;
  const start = opts?.fromState ?? scenario.initial;

  const eventLogEnabled = opts?.eventLog?.enabled ?? scenario.run.eventLog?.enabled ?? true;
  const maxEvents = opts?.eventLog?.maxEvents ?? scenario.run.eventLog?.maxEvents;

  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    throw new Error("offline eventLog.maxEvents must be an integer >= 0");
  }

  const resolved = resolveOfflineSeconds(seconds, opts?.policy ?? scenario.run.offline);
  assertSimulationClock("offline", { stepSec, durationSec: resolved.effectiveSec, maxSteps });
  const fullSteps = Math.floor(resolved.effectiveSec / stepSec);
  const remainderRaw = resolved.effectiveSec - fullSteps * stepSec;
  const remainderSec = remainderRaw > timeEpsilon(resolved.effectiveSec) ? remainderRaw : 0;

  const statsAcc = createSimStatsAccumulator();
  const eventBuffer = createEventBuffer<N>({
    enabled: eventLogEnabled,
    maxEvents,
  });
  const actionsLog: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }> = [];

  let state = start;
  let steps = 0;
  let simulatedSec = 0;
  const maxActionsPerStep = scenario.constraints?.maxActionsPerStep ?? Infinity;
  let stop: RunStop | undefined;

  while (stop === undefined) {
    const decision = nextBoundary({
      elapsedSec: state.t - start.t,
      steps,
      stepSec,
      durationSec: resolved.effectiveSec,
      untilMet: false,
      hasUntil: false,
      maxSteps,
    });
    if (decision.kind === "guard") {
      throw new Error(`offline run exceeded maxSteps (${maxSteps}) without meeting stop condition`);
    }
    if (decision.kind === "stop") {
      stop = decision.stop;
      break;
    }

    const stepCtx = stepContext(scenario.ctx, decision.dt);
    const decisions = useStrategy
      ? (scenario.strategy?.decide(stepCtx, scenario.model, state) ?? []).slice(0, maxActionsPerStep)
      : [];
    const actionStartT = state.t;
    const out = stepOnce({
      ctx: stepCtx,
      model: scenario.model,
      state,
      dt: decision.dt,
      decisions,
      constraints: scenario.constraints,
      fast: opts?.fast ?? scenario.run.fast,
    });

    state = out.next;
    simulatedSec += decision.dt;
    steps += 1;
    statsAcc.push(out.events);
    eventBuffer.pushTimed(timeStepEvents(out.events, actionStartT, state.t));
    if (out.actionsApplied?.length) {
      actionsLog.push(...out.actionsApplied);
    }
  }

  const stats = statsAcc.snapshot();
  const uxFlags = analyzeUX(stats);
  const retained = eventBuffer.snapshot();

  return {
    start,
    end: state,
    events: retained.events,
    eventTimeline: retained.eventTimeline,
    actionsLog: actionsLog.length > 0 ? actionsLog : undefined,
    stats,
    uxFlags,
    eventLog: retained.eventLog,
    stop,
    offline: {
      requestedSec: seconds,
      preDecaySec: resolved.preDecaySec,
      effectiveSec: resolved.effectiveSec,
      simulatedSec,
      stepSec,
      fullSteps,
      remainderSec,
      usedStrategy: useStrategy,
      overflow: resolved.overflow,
      decay: {
        kind: resolved.decayKind,
        ratio: resolved.decayRatio,
      },
    },
  };
}
