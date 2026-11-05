import {
  validateScenarioV1,
  type MultiCohortComparison, type ObservedCohort, type RetentionAssumptions, type RetentionDriftReport,
  type RetentionExperimentPlan, type RetentionUpdatePlan, type ScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { scenarioInvalidError, usageError } from "../errors";
import { runLtvAnalysis, ltvStageInputs, DEFAULT_LTV_HORIZONS, type LtvAnalysisResult } from "../commands/ltv";
import { prepareResolvedRun } from "./runConfiguration";

type Registries = Awaited<ReturnType<typeof import("../commands/_shared/plugin").loadRegistriesFromFlags>>;

const rate = z.number().min(0).max(1).optional();
const retentionDocument = z.object({
  schemaVersion: z.literal(1),
  monetization: z.object({ retention: z.object({ d1: rate, d7: rate, d30: rate, d90: rate }).passthrough().optional() }).passthrough().optional(),
}).passthrough();

/** Read only the explicit retention assumptions; reading does not load or run a plugin. */
export function scenarioRetentionAssumptions(document: unknown, label: string): RetentionAssumptions {
  const parsed = retentionDocument.safeParse(document);
  if (!parsed.success) throw usageError(`Invalid scenario retention assumptions in ${label}: ${parsed.error.message}`);
  const retention = parsed.data.monetization?.retention ?? {};
  const out: RetentionAssumptions = {};
  for (const key of ["d1", "d7", "d30", "d90"] as const) if (retention[key] !== undefined) out[key] = retention[key];
  return out;
}

export function cohortSummary(cohort: ObservedCohort) {
  const retention: Record<string, number | null> = {};
  for (const point of cohort.observation.retention) retention[`d${point.day}`] = point.rate;
  return {
    id: cohort.id, variant: cohort.variant, installDate: cohort.installDate,
    observedThroughDay: cohort.observation.observedThroughDay, users: cohort.observation.users, rows: cohort.rows, retention,
  };
}

const percent = (value: number | null | undefined) => value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(2)}%`;
const pp = (value: number | null | undefined) => value === null || value === undefined ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} pp`;

export function renderValidateMarkdown(cohorts: readonly ObservedCohort[]): string {
  const lines = [
    "# Cohort batch", "",
    `${cohorts.length} cohort(s) passed the export contract (day 0 record for every install, one row per user/day, no row after the cutoff).`, "",
    "| Cohort | Variant | Install date | Observed through | Users | D1 | D7 | D30 | D90 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const cohort of cohorts) {
    const rates = cohort.observation.retention.map(point => point.status === "observed" ? percent(point.rate) : "not observed");
    lines.push(`| ${cohort.id} | ${cohort.variant ?? ""} | ${cohort.installDate ?? ""} | day ${cohort.observation.observedThroughDay} | ${cohort.observation.users} | ${rates.join(" | ")} |`);
  }
  return lines.join("\n");
}

export function renderCompareMarkdown(comparison: MultiCohortComparison): string {
  const lines = ["# Multi-cohort retention comparison", "", `Baseline cohort: **${comparison.baseline}**. Significance hints use alpha ${comparison.alpha}.`, ""];
  for (const day of comparison.days) {
    lines.push(`## D${day.day}`, "", `Assumption: ${percent(day.assumption)}. Observed cohorts: ${day.observedCohorts}. Spread: ${day.spreadPercentagePoints === null ? "n/a" : `${day.spreadPercentagePoints.toFixed(2)} pp`}.`, "",
      "| Cohort | Variant | Retained / installed | Rate | Wilson 95% | vs baseline | vs assumption | Hint |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const cell of day.cohorts) {
      const hint = cell.cohortId === comparison.baseline ? "baseline" : cell.significance
        ? `${cell.significance.verdict}${cell.significance.pValue === null ? "" : ` (p=${cell.significance.pValue.toFixed(4)})`}` : "n/a";
      lines.push(`| ${cell.cohortId} | ${cell.variant ?? ""} | ${cell.activeUsers === null ? "not observed" : `${cell.activeUsers} / ${cell.users}`} | ${percent(cell.rate)} | ${cell.interval95 ? `${percent(cell.interval95.min)} to ${percent(cell.interval95.max)}` : "n/a"} | ${pp(cell.differenceFromBaselinePercentagePoints)} | ${pp(cell.differenceFromAssumptionPercentagePoints)} | ${hint} |`);
    }
    lines.push("");
  }
  lines.push(...comparison.notes.map(note => `- ${note}`));
  return lines.join("\n");
}

export type DriftOutput = Readonly<{
  status: "drift" | "within-threshold" | "no-comparable-days";
  thresholdPercentagePoints: number;
  requireIntervalExclusion: boolean;
  assumptions: RetentionAssumptions;
  cohorts: readonly (Readonly<{ id: string; variant: string | null; observedThroughDay: number; users: number }> & RetentionDriftReport)[];
}>;

export function renderDriftMarkdown(output: DriftOutput): string {
  const lines = [
    "# Retention drift", "",
    `Status: **${output.status}**. Threshold: ${output.thresholdPercentagePoints} percentage points${output.requireIntervalExclusion ? ", and the assumption must lie outside the cohort's Wilson 95% interval" : ""}.`, "",
    "| Cohort | Day | Assumption | Observed | Difference | Wilson 95% | Outside interval | Drift |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const cohort of output.cohorts) {
    if (cohort.findings.length === 0) lines.push(`| ${cohort.id} | n/a | n/a | n/a | n/a | n/a | n/a | ${cohort.status} |`);
    for (const finding of cohort.findings) {
      lines.push(`| ${cohort.id} | D${finding.day} | ${percent(finding.assumption)} | ${percent(finding.observed)} | ${pp(finding.differencePercentagePoints)} | ${percent(finding.interval95.min)} to ${percent(finding.interval95.max)} | ${finding.assumptionOutsideInterval ? "yes" : "no"} | ${finding.drift ? "**drift**" : "ok"} |`);
    }
  }
  lines.push("", "Drift compares explicit scenario assumptions with fully observed exact-day retention. It does not explain the cause; review the release, acquisition mix and export completeness before patching.");
  return lines.join("\n");
}

export function renderExperimentMarkdown(plan: RetentionExperimentPlan, experimentId: string): string {
  const lines = [
    `# Retention experiment plan: ${experimentId}`, "",
    `Metric: exact-day D${plan.retentionDay} retention. Baseline ${percent(plan.baselineRate)}, target ${percent(plan.targetRate)} (minimum detectable effect ${plan.minimumDetectableEffectPercentagePoints.toFixed(2)} pp).`,
    `Two-sided alpha ${plan.alpha} (${plan.adjustedAlpha} per comparison), power ${plan.power}.`, "",
    "| Group | Role | Scenario | Assumed retention | Required installs |", "| --- | --- | --- | --- | --- |",
    ...plan.groups.map(group => `| ${group.id} | ${group.role} | ${group.scenario ?? ""} | ${percent(group.assumedRetention)} | ${group.requiredUsers} |`), "",
    `Total installs: **${plan.totalUsers}**. Observe every enrolled install through day ${plan.observationWindow.observedThroughDay}.`,
    plan.observationWindow.enrollmentDays === null ? "Enrollment period: pass --daily-installs to estimate it." : `Enrollment: ${plan.observationWindow.enrollmentDays} days; earliest readout on day ${plan.observationWindow.earliestReadoutDay} after launch.`, "",
    "## Recommendations", "", ...plan.recommendations.map(item => `- ${item}`),
  ];
  return lines.join("\n");
}

// --- patch workflow -----------------------------------------------------------

export type LtvRun = Readonly<{ analysis: LtvAnalysisResult; seed: number; effectiveRunHash: string }>;

/** Validate a scenario against the loaded registries and run the ltv stage with one seed. */
export function runScenarioLtv(args: {
  scenario: unknown;
  label: string;
  registries: Registries;
  horizons: string;
  strategy?: string;
  seed?: number;
}): LtvRun {
  const valid = validateScenarioV1(args.scenario, args.registries.modelRegistry, args.registries.strategyRegistry);
  if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues, args.label);
  const unseeded = prepareResolvedRun({
    scenario: valid.scenario,
    modelRegistry: args.registries.modelRegistry,
    strategyRegistry: args.registries.strategyRegistry,
    pluginDigest: args.registries.pluginDigest,
    strategyOverride: args.strategy,
  });
  const stageInputs = ltvStageInputs(valid.scenario, args.horizons);
  const seed = args.seed ?? unseeded.defaultSeed(
    {
      command: "ltv", scenario: valid.scenario,
      options: { horizons: DEFAULT_LTV_HORIZONS, step: valid.scenario.clock.stepSec, strategy: undefined, fast: false, draws: undefined, valuePerWorth: undefined },
    },
    [{ stage: "ltv", inputs: stageInputs, defaults: ltvStageInputs(valid.scenario, DEFAULT_LTV_HORIZONS) }],
  );
  const opened = unseeded.withSeed(seed).open("ltv", `ltv:${seed}`, stageInputs, { valuePerWorth: null });
  const analysis = runLtvAnalysis({
    scenario: valid.scenario, effectiveRunHash: opened.hash, compiled: opened.scenario,
    strategy: opened.scenario.strategy, horizonsRaw: args.horizons, seed,
  });
  return { analysis, seed, effectiveRunHash: opened.hash };
}

export type LtvPacingDiffRow = Readonly<{
  horizon: string;
  seconds: number;
  ltvPerUser: Readonly<{ before: number; after: number; delta: number; deltaPercent: number | null }>;
  netRevenuePerUser: Readonly<{ before: number; after: number; delta: number }>;
  pacing: Readonly<{
    endNetWorth: Readonly<{ before: string; after: string }>;
    timeToFirstUpgradeSec: Readonly<{ before: number | null; after: number | null }>;
    growthLog10PerDay: Readonly<{ before: number; after: number }>;
    changed: boolean;
  }>;
}>;

/** Horizon-by-horizon LTV and pacing difference between two ltv runs over the same horizons. */
export function diffLtvRuns(before: LtvAnalysisResult, after: LtvAnalysisResult): LtvPacingDiffRow[] {
  return before.horizons.map((row, index) => {
    const next = after.horizons[index];
    if (!next || next.seconds !== row.seconds) throw new Error("LTV diff requires matching horizons");
    const ltvBefore = row.monetization.cumulativeLtvPerUser;
    const ltvAfter = next.monetization.cumulativeLtvPerUser;
    const changed = row.endNetWorth !== next.endNetWorth || row.guardrails.timeToFirstUpgradeSec !== next.guardrails.timeToFirstUpgradeSec || row.guardrails.growthLog10PerDay !== next.guardrails.growthLog10PerDay;
    return {
      horizon: row.horizon,
      seconds: row.seconds,
      ltvPerUser: { before: ltvBefore, after: ltvAfter, delta: ltvAfter - ltvBefore, deltaPercent: ltvBefore === 0 ? null : ((ltvAfter - ltvBefore) / Math.abs(ltvBefore)) * 100 },
      netRevenuePerUser: {
        before: row.monetization.cumulativeNetRevenuePerUser, after: next.monetization.cumulativeNetRevenuePerUser,
        delta: next.monetization.cumulativeNetRevenuePerUser - row.monetization.cumulativeNetRevenuePerUser,
      },
      pacing: {
        endNetWorth: { before: row.endNetWorth, after: next.endNetWorth },
        timeToFirstUpgradeSec: { before: row.guardrails.timeToFirstUpgradeSec, after: next.guardrails.timeToFirstUpgradeSec },
        growthLog10PerDay: { before: row.guardrails.growthLog10PerDay, after: next.guardrails.growthLog10PerDay },
        changed,
      },
    };
  });
}

export type PatchWorkflowOutput = Readonly<{
  cohort: ReturnType<typeof cohortSummary>;
  scenario: string;
  patchStatus: RetentionUpdatePlan["plan"]["status"];
  patchWarnings: readonly string[];
  scenarioPatch: Readonly<{ monetization: Readonly<{ retention: RetentionAssumptions }> }>;
  changes: RetentionUpdatePlan["changes"];
  validation: Readonly<{ ok: boolean }> | null;
  scenarioOut: string | null;
  seed: number | null;
  diff: readonly LtvPacingDiffRow[];
}>;

export function renderPatchMarkdown(output: PatchWorkflowOutput): string {
  const lines = [
    "# Retention patch workflow", "",
    `Cohort **${output.cohort.id}** (${output.cohort.users} installs, observed through day ${output.cohort.observedThroughDay}) against \`${output.scenario}\`.`, "",
    `1. Observe: ${["d1", "d7", "d30", "d90"].map(key => `${key.toUpperCase()} ${percent(output.cohort.retention[key])}`).join(", ")}.`,
    `2. Patch: **${output.patchStatus}**.`,
    `3. Validate: ${output.validation === null ? "skipped (no ready patch)" : output.validation.ok ? "patched scenario is valid" : "failed"}.`,
    `4. Re-simulate: ${output.diff.length ? `ltv before and after with seed ${output.seed}` : "skipped"}.`, "",
  ];
  if (output.patchWarnings.length) lines.push(...output.patchWarnings.map(warning => `- ${warning}`), "");
  if (output.changes.length) {
    lines.push("## Scenario changes", "", "| Assumption | Before | After | Change |", "| --- | --- | --- | --- |");
    for (const change of output.changes) lines.push(`| monetization.retention.${change.key} | ${percent(change.before)} | ${percent(change.after)} | ${change.before === null || change.after === null ? "n/a" : pp((change.after - change.before) * 100)} |`);
    lines.push("");
  }
  if (output.diff.length) {
    lines.push("## LTV and pacing before and after", "", "| Horizon | LTV/user before | after | Δ | Δ% | First upgrade (s) before → after | Pacing changed |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const row of output.diff) {
      lines.push(`| ${row.horizon} | ${row.ltvPerUser.before.toFixed(4)} | ${row.ltvPerUser.after.toFixed(4)} | ${row.ltvPerUser.delta >= 0 ? "+" : ""}${row.ltvPerUser.delta.toFixed(4)} | ${row.ltvPerUser.deltaPercent === null ? "n/a" : `${row.ltvPerUser.deltaPercent.toFixed(2)}%`} | ${row.pacing.timeToFirstUpgradeSec.before ?? "n/a"} → ${row.pacing.timeToFirstUpgradeSec.after ?? "n/a"} | ${row.pacing.changed ? "yes" : "no"} |`);
    }
    lines.push("", "Retention assumptions feed the LTV projection, not the economy simulation, so pacing should stay unchanged; a pacing change means something other than retention moved.");
  }
  if (output.scenarioOut) lines.push("", `Patched scenario written to \`${output.scenarioOut}\`. Review it before replacing the source scenario.`);
  return lines.join("\n");
}

export type { ScenarioV1 };
