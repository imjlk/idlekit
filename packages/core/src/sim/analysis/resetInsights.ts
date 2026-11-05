import { runScenario } from "../simulator";
import { assertHorizonReached, type CompiledScenario } from "../types";
import { withoutResetActions } from "./resetActions";
import {
  analyzeResetPolicies,
  ResetPolicyRejected,
  type ResetPolicyArtifactV1,
  type ResetPolicyRequest,
} from "./resetOptimization";

/*
 * Design-facing reading of a reset-policy artifact: reward per hour, per-cycle reward, return on resetting against a
 * no-reset baseline, the robust timing window, and the stability verdict for every scanned interval.
 * It reads the artifact `analyzeResetPolicies` produced; it does not re-rank candidates or re-run them.
 */

export type ResetCycleInsightRowV1 = Readonly<{
  intervalSec: number;
  status: ResetPolicyArtifactV1["candidates"][number]["status"];
  completedCycles: number;
  /** Realized reward per hour of completed cycle time. Null when no cycle completed. */
  rewardPerHour: number | null;
  /** Mean realized reward of one completed cycle. */
  rewardPerCycle: number | null;
  finalPoints: string;
  finalNetWorth: string;
  /**
   * finalNetWorth / baseline net worth - 1, at the horizon. Null without a baseline, with a zero baseline, or when the
   * horizon ends on a committed reset: that net worth is the fresh cycle's and reads as -100%.
   */
  roiVsNoReset: number | null;
  stability: ResetPolicyArtifactV1["candidates"][number]["stability"]["status"];
  recoverySec: number | null;
}>;

export type ResetCycleInsightsV1 = Readonly<{
  schemaVersion: 1;
  kind: "reset-cycle-insights";
  objective: ResetPolicyArtifactV1["objective"];
  optimalIntervalSec: number;
  /** Scanned intervals whose ranking reading is within `plateauTolerance` of the best: a safe timing window. */
  timingWindow: Readonly<{ fromSec: number; toSec: number; tolerance: number }>;
  baseline: Readonly<{ kind: "no-reset"; horizonSec: number; netWorth: string }> | null;
  rows: readonly ResetCycleInsightRowV1[];
  hints: readonly string[];
}>;

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Net worth after `horizonSec` with every reset action hidden from the strategy: the "never reset" reference
 * that `roiVsNoReset` divides by.
 */
export function noResetBaselineNetWorth<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>, horizonSec: number): N {
  const model = withoutResetActions(scenario.model, undefined);
  const run = runScenario({ ...scenario, model, run: { ...scenario.run, durationSec: horizonSec, trace: undefined } });
  assertHorizonReached(run, "noResetBaselineNetWorth");
  return (model.netWorth?.(scenario.ctx, run.end) ?? run.end.wallet.money).amount;
}

export function summarizeResetPolicy(
  artifact: ResetPolicyArtifactV1,
  options: Readonly<{ baselineNetWorth?: string; plateauTolerance?: number }> = {},
): ResetCycleInsightsV1 {
  const tolerance = options.plateauTolerance ?? 0.05;
  if (!(tolerance >= 0 && tolerance < 1)) throw new ResetPolicyRejected("plateauTolerance must be in [0, 1)");
  const baseline = num(options.baselineNetWorth);
  const rows: ResetCycleInsightRowV1[] = artifact.candidates.map((row) => {
    const rate = num(row.rewardRate);
    const realized = num(row.realizedReward);
    const worth = num(row.finalNetWorth);
    return {
      intervalSec: row.intervalSec,
      status: row.status,
      completedCycles: row.completedCycles,
      rewardPerHour: rate === null ? null : rate * 3600,
      rewardPerCycle: realized !== null && row.completedCycles > 0 ? realized / row.completedCycles : null,
      finalPoints: row.finalPoints,
      finalNetWorth: row.finalNetWorth,
      roiVsNoReset:
        baseline !== null && baseline > 0 && worth !== null && row.incomplete !== null && row.incomplete.durationSec > 0
          ? worth / baseline - 1
          : null,
      stability: row.stability.status,
      recoverySec: row.recovery.seconds,
    };
  });

  // The window reads the same objective the artifact ranked by. Lower is better only for goal time.
  const reading = (index: number): number | null => num(artifact.candidates[index]?.objectiveValue);
  const bestIndex = artifact.candidates.findIndex((row) => row.intervalSec === artifact.best.intervalSec);
  const bestValue = bestIndex >= 0 ? reading(bestIndex) : null;
  const lowerIsBetter = artifact.objective === "goal-reach-sec";
  const within = (index: number): boolean => {
    const value = reading(index);
    if (value === null || bestValue === null) return index === bestIndex;
    const slack = Math.abs(bestValue) * tolerance;
    return lowerIsBetter ? value <= bestValue + slack : value >= bestValue - slack;
  };
  let from = bestIndex;
  let to = bestIndex;
  while (from > 0 && within(from - 1)) from -= 1;
  while (to >= 0 && to < artifact.candidates.length - 1 && within(to + 1)) to += 1;
  const window = {
    fromSec: artifact.candidates[Math.max(0, from)]?.intervalSec ?? artifact.best.intervalSec,
    toSec: artifact.candidates[Math.max(0, to)]?.intervalSec ?? artifact.best.intervalSec,
    tolerance,
  };

  const best = rows.find((row) => row.intervalSec === artifact.best.intervalSec);
  const hints: string[] = [];
  if (best) {
    const rate = best.rewardPerHour === null ? "n/a" : best.rewardPerHour.toPrecision(4);
    hints.push(`Reset about every ${best.intervalSec}s: ${rate} reward/hour over ${best.completedCycles} completed cycles (scan-range best).`);
    if (window.fromSec !== window.toSec) {
      hints.push(`Any interval from ${window.fromSec}s to ${window.toSec}s stays within ${Math.round(tolerance * 100)}% of the best; the timing is forgiving.`);
    } else {
      hints.push(`No neighbouring interval stays within ${Math.round(tolerance * 100)}% of the best; reset timing is sensitive.`);
    }
    if (best.roiVsNoReset === null && options.baselineNetWorth !== undefined) {
      hints.push("The horizon ends on a reset for the best interval, so ROI against never resetting is not read; use a horizon that leaves a tail.");
    }
    if (best.roiVsNoReset !== null) {
      hints.push(
        best.roiVsNoReset > 0
          ? `Resetting ends ${(best.roiVsNoReset * 100).toFixed(1)}% above never resetting over the horizon.`
          : `Resetting ends ${(-best.roiVsNoReset * 100).toFixed(1)}% below never resetting over the horizon; the multiplier does not pay back yet.`,
      );
    }
    if (best.stability === "drifting" || best.stability === "non-stationary") {
      hints.push(`Cycle rewards keep changing (${best.stability}); the loop has not settled, so later resets differ from early ones.`);
    } else if (best.stability === "oscillating") {
      hints.push("Cycle rewards alternate; check the reset threshold against the multiplier step.");
    } else if (best.stability === "insufficient-data") {
      hints.push("Too few completed cycles to judge stability; extend the horizon or shorten the scan.");
    }
  }
  if (artifact.status !== "ok") hints.push(`Artifact status is ${artifact.status}; read the candidate statuses before acting.`);

  return {
    schemaVersion: 1,
    kind: "reset-cycle-insights",
    objective: artifact.objective,
    optimalIntervalSec: artifact.best.intervalSec,
    timingWindow: window,
    baseline: options.baselineNetWorth === undefined ? null : { kind: "no-reset", horizonSec: artifact.best.comparison.horizonSec, netWorth: options.baselineNetWorth },
    rows,
    hints,
  };
}

export type ResetLayerV1<N, U extends string, Vars> = Readonly<{
  id: string;
  /**
   * Build this layer's request. `inner` is the result of the layer below (null for the first layer), so an outer
   * layer (ascension) can fix the inner reset (prestige) at its chosen interval, for example through a strategy
   * or an adapter that commits the inner reset on that schedule.
   */
  request: (inner: ResetLayerResultV1 | null) => ResetPolicyRequest<N, U, Vars>;
}>;

export type ResetLayerResultV1 = Readonly<{
  id: string;
  artifact: ResetPolicyArtifactV1;
  insights: ResetCycleInsightsV1;
}>;

/**
 * Multi-layer reset hook (prestige -> ascension -> ...). Layers run innermost first. Each layer is an ordinary
 * `analyzeResetPolicies` request built from the layer below; this function only sequences them and keeps each
 * artifact. It does not search the layers jointly.
 */
export function analyzeResetLayers<N, U extends string, Vars>(
  layers: readonly ResetLayerV1<N, U, Vars>[],
): readonly ResetLayerResultV1[] {
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > 8) {
    throw new ResetPolicyRejected("reset layers must list 1 to 8 layers");
  }
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) {
    throw new ResetPolicyRejected("reset layer ids must be unique");
  }
  const out: ResetLayerResultV1[] = [];
  for (const layer of layers) {
    const artifact = analyzeResetPolicies(layer.request(out.at(-1) ?? null));
    out.push({ id: layer.id, artifact, insights: summarizeResetPolicy(artifact) });
  }
  return out;
}
