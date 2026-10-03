import { timeEpsilon } from "./timeBoundary";
import type { ScenarioConstraints } from "./types";

/**
 * Cooldown anchor contract. TC-05 has not registered this DTO.
 * A missing last reset time is unknown. This host does not invent one.
 *
 * @evidence docs/requirements/active/planner-rollout.md#req-pr04-planner-rollout The same cooldown rule gates a committed step and a planner preview.
 * @evidenceReview docs/requirements/active/planner-rollout.md#req-pr04-planner-rollout #a52946e Re-read the section: 59 seconds is blocked when the last reset is known, 60 is allowed, and a missing anchor is not rewritten as a past time.
 */
export const prestigeCooldownContract = "idlekit.prestige-cooldown" as const;

export type PrestigeCooldownStatus = "ready" | "cooling" | "unanchored";

export type PrestigeCooldownDecision = Readonly<{
  status: PrestigeCooldownStatus;
  allowed: boolean;
  readyAtT?: number;
  warning?: string;
}>;

const unanchoredWarning =
  "Prestige cooldown has no recorded last reset time. No past timestamp is invented. The next committed reset starts the interval.";

export function decidePrestigeCooldown(args: {
  nowT: number;
  minIntervalSec?: number;
  lastResetT?: number;
}): PrestigeCooldownDecision {
  const interval = args.minIntervalSec;
  if (interval === undefined || !Number.isFinite(interval) || interval <= 0) {
    return { status: "ready", allowed: true };
  }
  if (args.lastResetT === undefined || !Number.isFinite(args.lastResetT)) {
    return { status: "unanchored", allowed: true, warning: unanchoredWarning };
  }
  const readyAtT = args.lastResetT + interval;
  // An accumulated clock can land just short of readyAtT. The dust scales with the interval,
  // not the timestamp, plus the rounding of the two operands of the subtraction. It stays
  // below half the interval, so a timestamp too large to resolve the interval keeps cooling.
  const elapsed = args.nowT - args.lastResetT;
  const subtractionDust = Number.EPSILON * Math.max(Math.abs(args.nowT), Math.abs(args.lastResetT));
  const tolerance = Math.min(timeEpsilon(interval) + subtractionDust, interval / 2);
  if (elapsed >= interval - tolerance) {
    return { status: "ready", allowed: true, readyAtT };
  }
  return { status: "cooling", allowed: false, readyAtT };
}

export function constraintsWithAnchor(
  constraints: ScenarioConstraints | undefined,
  lastResetT: number | undefined,
): ScenarioConstraints | undefined {
  if (lastResetT === undefined) {
    if (constraints?.lastPrestigeResetT === undefined) return constraints;
    const { lastPrestigeResetT: _ignored, ...rest } = constraints;
    return rest;
  }
  return { ...constraints, lastPrestigeResetT: lastResetT };
}

export type PrestigeAnchor = Readonly<{
  status: "recorded" | "unanchored";
  lastResetT?: number;
  warning?: string;
}>;

export function recordPrestigeReset(
  constraints: ScenarioConstraints | undefined,
  resetT: number | undefined,
  onReset?: (t: number) => void,
): ScenarioConstraints | undefined {
  if (resetT === undefined) return constraints;
  onReset?.(resetT);
  return constraintsWithAnchor(constraints, resetT);
}

export function prestigeAnchorFromCheckpoint(checkpoint: {
  runner?: { lastPrestigeResetT?: number; prestigeReadyAtSec?: number };
} | undefined): PrestigeAnchor {
  const lastResetT = checkpoint?.runner?.lastPrestigeResetT;
  if (typeof lastResetT === "number" && Number.isFinite(lastResetT)) {
    return { status: "recorded", lastResetT };
  }
  return { status: "unanchored", warning: unanchoredWarning };
}
