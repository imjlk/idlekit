import { assertLogBudget } from "./eventBuffer";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import { simStatsFromCounters, type MetricStatus, type SimStats } from "./analysis/ux";
import type { SimEvent, SimState } from "./types";

/**
 * Resolved observation contract. TC-05 has not registered this DTO.
 *
 * @evidence docs/requirements/active/observation-retention.md#req-pr05-observation-retention Counters come from the committed step, not from the retained event log.
 * @evidenceReview docs/requirements/active/observation-retention.md#req-pr05-observation-retention #fbd26db Re-read the section: retention does not change these counters, a disabled mode is missing rather than zero, and a sample cap does not hide a fact from the observer.
 */
export const observationContract = "idlekit.run-observation" as const;

export type ObservationCoverage = "complete" | "partial" | "incomplete" | "disabled";

export type MoneyFacts = Readonly<{
  applied: number;
  dropped: number;
  queued: number;
  flushed: number;
  blocked: number;
}>;

export type RewardGapSummary = Readonly<{
  status: MetricStatus;
  startT: number;
  endT: number;
  firstRewardT?: number;
  lastRewardT?: number;
  /** Largest gap between two rewards inside the span. Boundary gaps are merged here. */
  interiorMaxGapSec: number;
}>;

export type MilestoneSample = Readonly<{
  key: string;
  firstSeenT: number;
  source: "milestone" | "action" | "prestige" | "goal";
}>;

export type GoalSample = Readonly<{
  id: string;
  status: "reached" | "unreached";
  t?: number;
}>;

export type RunObservation = Readonly<{
  contract: typeof observationContract;
  version: 1;
  coverage: ObservationCoverage;
  /** True when the only inputs were retained events from a result that had no stats. */
  legacyEventFallback: boolean;
  money: MoneyFacts & Readonly<{ status: MetricStatus }>;
  actions: Readonly<{
    status: MetricStatus;
    applied: number;
    skippedCannotApply: number;
    skippedInsufficientFunds: number;
    skippedInvalidQuote: number;
    skippedCooldown: number;
  }>;
  rewardGap: RewardGapSummary;
  milestones: readonly MilestoneSample[];
  goals: readonly GoalSample[];
  /** Distinct keys left out by maxMilestones. A merge sums its parts, and each session segment has its own cap. */
  droppedMilestones: number;
  /** Distinct met goals left out by maxGoals. Summed the same way on a merge. */
  droppedGoals: number;
}>;

export type RunObserver = Readonly<{
  onStep?: (fact: Readonly<{ t0: number; t1: number; dt: number }>) => void;
  onAction?: (fact: Readonly<{ t: number; actionId: string; outcome: "applied" | "skipped"; reason?: string }>) => void;
  onMilestone?: (fact: Readonly<{ t: number; key: string }>) => void;
  onGoal?: (fact: Readonly<{ t: number; goalId: string }>) => void;
}>;

export type RunGoal<N, U extends string, Vars> = Readonly<{
  id: string;
  met: (state: SimState<N, U, Vars>) => boolean;
}>;

export class ObservationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ObservationError";
  }
}

type MutableMoney = {
  applied: number;
  dropped: number;
  queued: number;
  flushed: number;
  blocked: number;
};

const emptyMoney = (): MoneyFacts => ({ applied: 0, dropped: 0, queued: 0, flushed: 0, blocked: 0 });

function mutableMoney(): MutableMoney {
  return { applied: 0, dropped: 0, queued: 0, flushed: 0, blocked: 0 };
}

export function maxNoRewardGapSec(gap: RewardGapSummary): number | null {
  if (gap.status !== "observed") return null;
  const span = gap.endT - gap.startT;
  if (gap.firstRewardT === undefined || gap.lastRewardT === undefined) return span;
  return Math.max(gap.firstRewardT - gap.startT, gap.endT - gap.lastRewardT, gap.interiorMaxGapSec);
}

export function mergeRewardGaps(parts: readonly RewardGapSummary[]): RewardGapSummary {
  if (parts.length === 0) {
    return { status: "missing", startT: 0, endT: 0, interiorMaxGapSec: 0 };
  }
  let acc = parts[0]!;
  for (let i = 1; i < parts.length; i += 1) acc = mergeRewardGapPair(acc, parts[i]!);
  return acc;
}

function mergeRewardGapPair(left: RewardGapSummary, right: RewardGapSummary): RewardGapSummary {
  if (left.status !== "observed" || right.status !== "observed") {
    return {
      status: "missing",
      startT: left.startT,
      endT: right.endT,
      interiorMaxGapSec: 0,
    };
  }
  const leftHas = left.firstRewardT !== undefined && left.lastRewardT !== undefined;
  const rightHas = right.firstRewardT !== undefined && right.lastRewardT !== undefined;
  let interior = Math.max(left.interiorMaxGapSec, right.interiorMaxGapSec);
  if (leftHas && rightHas) {
    interior = Math.max(interior, right.firstRewardT! - left.lastRewardT!);
  }
  return {
    status: "observed",
    startT: left.startT,
    endT: right.endT,
    firstRewardT: leftHas ? left.firstRewardT : right.firstRewardT,
    lastRewardT: rightHas ? right.lastRewardT : left.lastRewardT,
    interiorMaxGapSec: interior,
  };
}

function addMoney(left: MoneyFacts, right: MoneyFacts): MoneyFacts {
  return {
    applied: left.applied + right.applied,
    dropped: left.dropped + right.dropped,
    queued: left.queued + right.queued,
    flushed: left.flushed + right.flushed,
    blocked: left.blocked + right.blocked,
  };
}

function earlier(samples: readonly MilestoneSample[]): MilestoneSample[] {
  const byKey = new Map<string, MilestoneSample>();
  for (const sample of samples) {
    const prev = byKey.get(sample.key);
    if (!prev || sample.firstSeenT < prev.firstSeenT || (sample.firstSeenT === prev.firstSeenT && sample.source < prev.source)) {
      byKey.set(sample.key, sample);
    }
  }
  return [...byKey.values()].sort((a, b) => a.firstSeenT - b.firstSeenT || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function mergeObservations(parts: readonly RunObservation[]): RunObservation {
  if (parts.length === 0) {
    return disabledObservation(0, 0);
  }
  const coverage = parts.some((part) => part.coverage === "incomplete")
    ? "incomplete"
    : parts.some((part) => part.coverage === "disabled")
      ? "disabled"
      : parts.some((part) => part.coverage === "partial")
        ? "partial"
        : "complete";
  const moneyObserved = parts.every((part) => part.money.status === "observed" && !part.legacyEventFallback);
  const actionsObserved = parts.every((part) => part.actions.status === "observed" && !part.legacyEventFallback);
  const goals = new Map<string, GoalSample>();
  for (const part of parts) {
    for (const goal of part.goals) {
      const prev = goals.get(goal.id);
      if (!prev || (goal.status === "reached" && (prev.status !== "reached" || (goal.t ?? Infinity) < (prev.t ?? Infinity)))) {
        goals.set(goal.id, goal);
      }
    }
  }
  return {
    contract: observationContract,
    version: 1,
    coverage,
    legacyEventFallback: parts.some((part) => part.legacyEventFallback),
    money: {
      status: moneyObserved ? "observed" : "missing",
      ...(moneyObserved ? parts.reduce((sum, part) => addMoney(sum, part.money), emptyMoney()) : emptyMoney()),
    },
    actions: {
      status: actionsObserved ? "observed" : "missing",
      applied: actionsObserved ? parts.reduce((sum, part) => sum + part.actions.applied, 0) : 0,
      skippedCannotApply: actionsObserved ? parts.reduce((sum, part) => sum + part.actions.skippedCannotApply, 0) : 0,
      skippedInsufficientFunds: actionsObserved ? parts.reduce((sum, part) => sum + part.actions.skippedInsufficientFunds, 0) : 0,
      skippedInvalidQuote: actionsObserved ? parts.reduce((sum, part) => sum + part.actions.skippedInvalidQuote, 0) : 0,
      skippedCooldown: actionsObserved ? parts.reduce((sum, part) => sum + part.actions.skippedCooldown, 0) : 0,
    },
    rewardGap: mergeRewardGaps(parts.map((part) => part.rewardGap)),
    milestones: earlier(parts.flatMap((part) => part.milestones)),
    goals: [...goals.values()],
    droppedMilestones: parts.reduce((sum, part) => sum + part.droppedMilestones, 0),
    droppedGoals: parts.reduce((sum, part) => sum + part.droppedGoals, 0),
  };
}

export function statsFromObservation(observation: RunObservation): SimStats {
  return simStatsFromCounters({
    coverage: observation.coverage,
    money: observation.money,
    actions: observation.actions,
  });
}

function disabledObservation(startT: number, endT: number): RunObservation {
  return {
    contract: observationContract,
    version: 1,
    coverage: "disabled",
    legacyEventFallback: false,
    money: { status: "missing", ...emptyMoney() },
    actions: { status: "missing", applied: 0, skippedCannotApply: 0, skippedInsufficientFunds: 0, skippedInvalidQuote: 0, skippedCooldown: 0 },
    rewardGap: { status: "missing", startT, endT, interiorMaxGapSec: 0 },
    milestones: [],
    goals: [],
    droppedMilestones: 0,
    droppedGoals: 0,
  };
}

function notify(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (error instanceof ObservationError) throw error;
    throw new ObservationError("observer callback failed", error);
  }
}

export function createObservationRecorder<N, U extends string, Vars>(args: {
  enabled: boolean;
  startT: number;
  maxMilestones: number;
  maxGoals: number;
  goals: readonly RunGoal<N, U, Vars>[];
  observer?: RunObserver;
}) {
  assertLogBudget(args.maxMilestones, "observation.maxMilestones");
  assertLogBudget(args.maxGoals, "observation.maxGoals");
  const money = mutableMoney();
  const actions = { applied: 0, skippedCannotApply: 0, skippedInsufficientFunds: 0, skippedInvalidQuote: 0, skippedCooldown: 0 };
  const milestones: MilestoneSample[] = [];
  const seenMilestone = new Set<string>();
  const reachedGoals = new Map<string, number>();
  // A met goal past maxGoals. Counted once and left out of the output.
  const droppedGoals = new Set<string>();
  let droppedMilestones = 0;
  let endT = args.startT;
  let firstRewardT: number | undefined;
  let lastRewardT: number | undefined;
  let interiorMaxGapSec = 0;
  const enabled = args.enabled;

  const rememberMilestone = (sample: MilestoneSample, notifyMilestone: boolean) => {
    if (!enabled) return;
    if (seenMilestone.has(sample.key)) return;
    // A dropped key is seen too, so a recurring key counts once.
    seenMilestone.add(sample.key);
    // The cap limits retained samples, not what the observer is told.
    if (milestones.length >= args.maxMilestones) droppedMilestones += 1;
    else milestones.push(sample);
    if (notifyMilestone && args.observer?.onMilestone) {
      notify(() => args.observer?.onMilestone?.({ t: sample.firstSeenT, key: sample.key }));
    }
  };

  return {
    recordStep(step: {
      t0: number;
      t1: number;
      dt: number;
      events: readonly SimEvent<N>[];
      observedMoney?: MoneyFacts & { rewarded?: boolean };
      prestigeChanged: boolean;
      state: SimState<N, U, Vars>;
    }): void {
      endT = step.t1;
      if (!enabled) return;
      if (args.observer?.onStep) notify(() => args.observer?.onStep?.({ t0: step.t0, t1: step.t1, dt: step.dt }));
      if (step.observedMoney) {
        money.applied += step.observedMoney.applied;
        money.dropped += step.observedMoney.dropped;
        money.queued += step.observedMoney.queued;
        money.flushed += step.observedMoney.flushed;
        money.blocked += step.observedMoney.blocked;
        if (step.observedMoney.rewarded) {
          if (lastRewardT !== undefined) interiorMaxGapSec = Math.max(interiorMaxGapSec, step.t1 - lastRewardT);
          if (firstRewardT === undefined) firstRewardT = step.t1;
          lastRewardT = step.t1;
        }
      }
      for (const event of step.events) {
        if (event.type === "action.applied") {
          actions.applied += 1;
          if (args.observer?.onAction) {
            notify(() => args.observer?.onAction?.({ t: step.t0, actionId: event.actionId, outcome: "applied" }));
          }
          rememberMilestone({ key: `action.${event.actionId}.firstApplied`, firstSeenT: step.t0, source: "action" }, false);
          rememberMilestone({ key: "progress.first-upgrade", firstSeenT: step.t0, source: "action" }, false);
        } else if (event.type === "action.skipped") {
          if (event.reason === "cannotApply") actions.skippedCannotApply += 1;
          if (event.reason === "insufficientFunds") actions.skippedInsufficientFunds += 1;
          if (event.reason === "invalidQuote") actions.skippedInvalidQuote += 1;
          if (event.reason === "cooldown") actions.skippedCooldown += 1;
          if (args.observer?.onAction) {
            notify(() =>
              args.observer?.onAction?.({
                t: step.t0,
                actionId: event.actionId,
                outcome: "skipped",
                reason: event.reason,
              }),
            );
          }
        } else if (event.type === "milestone") {
          rememberMilestone({ key: event.key, firstSeenT: step.t1, source: "milestone" }, true);
        }
      }
      if (step.prestigeChanged) {
        rememberMilestone({ key: "prestige.first", firstSeenT: step.t1, source: "prestige" }, true);
      }
      const open = (goal: RunGoal<N, U, Vars>) => !reachedGoals.has(goal.id) && !droppedGoals.has(goal.id);
      // Each open goal reads its own copy, so one predicate's write cannot reach the next.
      for (const goal of args.goals) {
        if (!open(goal)) continue;
        let met = false;
        notify(() => {
          met = goal.met(deepClonePreservingPrototype(step.state));
        });
        if (!met) continue;
        if (reachedGoals.size >= args.maxGoals) droppedGoals.add(goal.id);
        else reachedGoals.set(goal.id, step.t1);
        if (args.observer?.onGoal) notify(() => args.observer?.onGoal?.({ t: step.t1, goalId: goal.id }));
      }
    },
    finish(): RunObservation {
      if (!enabled) return disabledObservation(args.startT, endT);
      const goals: GoalSample[] = [];
      for (const goal of args.goals) {
        if (droppedGoals.has(goal.id)) continue;
        const t = reachedGoals.get(goal.id);
        goals.push(t === undefined ? { id: goal.id, status: "unreached" } : { id: goal.id, status: "reached", t });
      }
      const capped = droppedMilestones > 0 || droppedGoals.size > 0;
      return {
        contract: observationContract,
        version: 1,
        coverage: capped ? "partial" : "complete",
        legacyEventFallback: false,
        money: { status: "observed", ...money },
        actions: { status: "observed", ...actions },
        rewardGap: {
          status: "observed",
          startT: args.startT,
          endT,
          ...(firstRewardT !== undefined ? { firstRewardT, lastRewardT } : {}),
          interiorMaxGapSec,
        },
        milestones,
        goals,
        droppedMilestones,
        droppedGoals: droppedGoals.size,
      };
    },
  };
}

export function observationFromLegacyEvents<N>(args: {
  startT: number;
  endT: number;
  events: readonly SimEvent<N>[];
}): RunObservation {
  const money = mutableMoney();
  const actions = { applied: 0, skippedCannotApply: 0, skippedInsufficientFunds: 0, skippedInvalidQuote: 0, skippedCooldown: 0 };
  for (const event of args.events) {
    if (event.type === "money") {
      for (const moneyEvent of event.events) {
        if (moneyEvent.type === "applied") money.applied += 1;
        if (moneyEvent.type === "dropped") money.dropped += 1;
        if (moneyEvent.type === "queued") money.queued += 1;
        if (moneyEvent.type === "flushed") money.flushed += 1;
        if (moneyEvent.type === "blocked") money.blocked += 1;
      }
    } else if (event.type === "action.applied") actions.applied += 1;
    else if (event.type === "action.skipped") {
      if (event.reason === "cannotApply") actions.skippedCannotApply += 1;
      if (event.reason === "insufficientFunds") actions.skippedInsufficientFunds += 1;
      if (event.reason === "invalidQuote") actions.skippedInvalidQuote += 1;
      if (event.reason === "cooldown") actions.skippedCooldown += 1;
    }
  }
  return {
    contract: observationContract,
    version: 1,
    coverage: "incomplete",
    legacyEventFallback: true,
    money: { status: "observed", ...money },
    actions: { status: "observed", ...actions },
    rewardGap: { status: "missing", startT: args.startT, endT: args.endT, interiorMaxGapSec: 0 },
    milestones: [],
    goals: [],
    droppedMilestones: 0,
    droppedGoals: 0,
  };
}
