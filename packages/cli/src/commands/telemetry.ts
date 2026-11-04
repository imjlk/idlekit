import { resolve } from "path";
import { z } from "zod";
import {
  compareCohorts, detectRetentionDrift, planRetentionExperiment, planScenarioRetentionUpdate, validateScenarioV1,
  type ExperimentGroupInput,
} from "@idlekit/core";
import { defineCommand, option } from "../runtime/command";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { assertOutputNotInput, writeOutput } from "../io/writeOutput";
import { readScenarioFile } from "../io/readScenario";
import { writeTextFile } from "../runtime/bun";
import { loadCohortBatches, selectCohort } from "../lib/cohortBatch";
import {
  cohortSummary, diffLtvRuns, renderCompareMarkdown, renderDriftMarkdown, renderExperimentMarkdown, renderPatchMarkdown,
  renderValidateMarkdown, runScenarioLtv, scenarioRetentionAssumptions, type DriftOutput, type PatchWorkflowOutput,
} from "../lib/telemetryLoop";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { DEFAULT_LTV_HORIZONS } from "./ltv";

/** Exit status of a monitoring check that ran and found drift, distinct from a usage error. */
export const TELEMETRY_DRIFT_EXIT_CODE = 2;
/** Exit status of `telemetry patch` when the observation does not yield a ready patch. */
export const TELEMETRY_PATCH_NOT_READY_EXIT_CODE = 3;

const inputFormat = option(z.enum(["auto", "csv", "json"]).default("auto"), { description: "Cohort batch format (auto: .csv is CSV, anything else JSON)" });
const outputFormat = option(z.enum(["json", "md"]).default("json"), { description: "Output format" });
const out = option(z.string().optional(), { description: "Output path" });
const alpha = option(z.coerce.number().gt(0).lt(1).default(0.05), { description: "Two-sided significance level for hints" });

function telemetryMeta(command: string, cohorts: unknown, scenario?: unknown, scenarioPath?: string) {
  return buildOutputMeta({ command, telemetry: cohorts, scenario, scenarioPath: scenarioPath ? resolve(scenarioPath) : undefined });
}

export const telemetryValidateCommand = defineCommand({
  name: "validate",
  description: "Validate a standardized cohort batch (JSON or CSV, one or more files) and summarize each cohort",
  options: { "input-format": inputFormat, out, format: outputFormat },
  async handler({ flags, positional }) {
    if (positional.length === 0) throw usageError("Usage: idk telemetry validate <cohorts.json|csv> [more files...]");
    const loaded = await loadCohortBatches(positional, flags["input-format"]);
    await writeOutput({
      format: flags.format, outPath: flags.out, protectedInputs: loaded.sources,
      data: flags.format === "md" ? renderValidateMarkdown(loaded.cohorts) : { ok: true, sources: loaded.sources, cohorts: loaded.cohorts.map(cohortSummary) },
      meta: telemetryMeta("telemetry.validate", loaded.batch),
    });
  },
});

export const telemetryCompareCommand = defineCommand({
  name: "compare",
  description: "Compare exact-day retention across cohorts or experiment groups, with significance hints",
  options: {
    "input-format": inputFormat,
    baseline: option(z.string().min(1).optional(), { description: "Baseline cohort id (default: first cohort)" }),
    scenario: option(z.string().optional(), { description: "Also compare each cohort with this scenario's explicit retention assumptions" }),
    alpha, out, format: outputFormat,
  },
  async handler({ flags, positional }) {
    if (positional.length === 0) throw usageError("Usage: idk telemetry compare <cohorts.json|csv> [more files...] [--baseline <cohort-id>]");
    const loaded = await loadCohortBatches(positional, flags["input-format"]);
    const scenario = flags.scenario ? await readScenarioFile(flags.scenario) : undefined;
    const assumptions = scenario === undefined ? undefined : scenarioRetentionAssumptions(scenario, flags.scenario!);
    let comparison: ReturnType<typeof compareCohorts>;
    try { comparison = compareCohorts(loaded.cohorts, { baseline: flags.baseline, assumptions, alpha: flags.alpha }); }
    catch (error) { throw usageError(error instanceof Error ? error.message : String(error)); }
    await writeOutput({
      format: flags.format, outPath: flags.out,
      protectedInputs: [...loaded.sources, ...(flags.scenario ? [resolve(flags.scenario)] : [])],
      data: flags.format === "md" ? renderCompareMarkdown(comparison) : { ok: true, cohorts: loaded.cohorts.map(cohortSummary), comparison },
      meta: telemetryMeta("telemetry.compare", loaded.batch, scenario, flags.scenario),
    });
  },
});

export const telemetryDriftCommand = defineCommand({
  name: "drift",
  description: "Detect drift between scenario retention assumptions and observed cohorts; --fail-on-drift exits 2",
  options: {
    "input-format": inputFormat,
    scenario: option(z.string().optional(), { description: "Scenario whose explicit retention assumptions are monitored (required)" }),
    cohort: option(z.string().min(1).optional(), { description: "Check only this cohort id (default: every cohort)" }),
    "threshold-pp": option(z.coerce.number().min(0).max(100).default(5), { description: "Absolute difference in percentage points that counts as drift" }),
    "require-interval": option(z.coerce.boolean().default(true), { description: "Also require the assumption to lie outside the Wilson 95% interval (--no-require-interval to disable)" }),
    "fail-on-drift": option(z.coerce.boolean().default(false), { description: "Exit with status 2 after writing the report when any cohort drifts" }),
    out, format: outputFormat,
  },
  async handler({ flags, positional }) {
    if (positional.length === 0 || !flags.scenario) throw usageError("Usage: idk telemetry drift <cohorts.json|csv> --scenario <scenario.json> [--threshold-pp 5] [--fail-on-drift]");
    const loaded = await loadCohortBatches(positional, flags["input-format"]);
    const scenario = await readScenarioFile(flags.scenario);
    const assumptions = scenarioRetentionAssumptions(scenario, flags.scenario);
    const selected = flags.cohort ? [selectCohort(loaded, flags.cohort)] : loaded.cohorts;
    const cohorts = selected.map(cohort => ({
      id: cohort.id, variant: cohort.variant, observedThroughDay: cohort.observation.observedThroughDay, users: cohort.observation.users,
      ...detectRetentionDrift(cohort.observation, assumptions, { thresholdPercentagePoints: flags["threshold-pp"], requireIntervalExclusion: flags["require-interval"] }),
    }));
    const status: DriftOutput["status"] = cohorts.some(cohort => cohort.status === "drift") ? "drift"
      : cohorts.some(cohort => cohort.status === "within-threshold") ? "within-threshold" : "no-comparable-days";
    const output: DriftOutput = { status, thresholdPercentagePoints: flags["threshold-pp"], requireIntervalExclusion: flags["require-interval"], assumptions, cohorts };
    await writeOutput({
      format: flags.format, outPath: flags.out, protectedInputs: [...loaded.sources, resolve(flags.scenario)],
      data: flags.format === "md" ? renderDriftMarkdown(output) : { ok: true, ...output },
      meta: telemetryMeta("telemetry.drift", loaded.batch, scenario, flags.scenario),
    });
    if (flags["fail-on-drift"] && status === "drift") process.exitCode = TELEMETRY_DRIFT_EXIT_CODE;
  },
});

export const telemetryPatchCommand = defineCommand({
  name: "patch",
  description: "Observed retention -> scenario patch -> validate -> re-run ltv, with a before/after LTV and pacing diff",
  options: {
    ...pluginOptions(),
    "input-format": inputFormat,
    scenario: option(z.string().optional(), { description: "Scenario to patch (required; never modified in place)" }),
    cohort: option(z.string().min(1).optional(), { description: "Cohort id (required when the batch has several cohorts)" }),
    "scenario-out": option(z.string().optional(), { description: "Write the validated patched scenario JSON to this path" }),
    horizons: option(z.string().default(DEFAULT_LTV_HORIZONS), { description: "Comma-separated ltv horizons for the before/after re-run" }),
    strategy: option(z.string().min(1).optional(), { description: "Registered strategy id for both runs" }),
    seed: option(z.coerce.number().int().optional(), { description: "Seed for both runs (default: the unpatched scenario's ltv seed)" }),
    out, format: outputFormat,
  },
  async handler({ flags, positional }) {
    if (positional.length === 0 || !flags.scenario) throw usageError("Usage: idk telemetry patch <cohorts.json|csv> --scenario <scenario.json> [--cohort <id>] [--scenario-out patched.json]");
    const loaded = await loadCohortBatches(positional, flags["input-format"]);
    const cohort = selectCohort(loaded, flags.cohort);
    const protectedInputs = [...loaded.sources, resolve(flags.scenario)];
    const scenarioOut = flags["scenario-out"] ? await assertOutputNotInput(flags["scenario-out"], { protectedInputs }) : undefined;
    if (scenarioOut && flags.out && resolve(flags.out) === scenarioOut) throw usageError("--out and --scenario-out must be different paths");
    const document = await readScenarioFile(flags.scenario);
    const registries = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(document, registries.modelRegistry, registries.strategyRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues, flags.scenario);
    let update: ReturnType<typeof planScenarioRetentionUpdate>;
    try { update = planScenarioRetentionUpdate(valid.scenario, cohort.observation); }
    catch (error) { throw usageError(error instanceof Error ? error.message : String(error)); }
    let validation: PatchWorkflowOutput["validation"] = null;
    let seed: number | null = null;
    let diff: PatchWorkflowOutput["diff"] = [];
    if (update.scenario) {
      const patchedValid = validateScenarioV1(update.scenario, registries.modelRegistry, registries.strategyRegistry);
      validation = { ok: patchedValid.ok };
      if (!patchedValid.ok) throw scenarioInvalidError(patchedValid.issues, "patched scenario");
      const before = runScenarioLtv({ scenario: valid.scenario, label: flags.scenario, registries, horizons: flags.horizons, strategy: flags.strategy, seed: flags.seed });
      // One seed for both runs, so only the patched assumptions differ.
      const after = runScenarioLtv({ scenario: update.scenario, label: "patched scenario", registries, horizons: flags.horizons, strategy: flags.strategy, seed: before.seed });
      seed = before.seed;
      diff = diffLtvRuns(before.analysis, after.analysis);
      if (scenarioOut) await writeTextFile(scenarioOut, `${JSON.stringify(update.scenario, null, 2)}\n`);
    }
    const output: PatchWorkflowOutput = {
      cohort: cohortSummary(cohort), scenario: flags.scenario,
      patchStatus: update.plan.status, patchWarnings: update.plan.warnings,
      scenarioPatch: { monetization: { retention: update.plan.retention } },
      changes: update.changes, validation, scenarioOut: update.scenario && scenarioOut ? scenarioOut : null, seed, diff,
    };
    await writeOutput({
      format: flags.format, outPath: flags.out, protectedInputs,
      data: flags.format === "md" ? renderPatchMarkdown(output) : { ok: true, ...output },
      meta: telemetryMeta("telemetry.patch", { cohort: cohort.id, observation: cohort.observation }, valid.scenario, flags.scenario),
    });
    if (update.plan.status !== "ready") process.exitCode = TELEMETRY_PATCH_NOT_READY_EXIT_CODE;
  },
});

function parseVariant(token: string): { id: string; path: string } {
  const index = token.indexOf("=");
  if (index <= 0 || index === token.length - 1) throw usageError(`Experiment variant must be <group>=<scenario.json>: ${token}`);
  return { id: token.slice(0, index), path: token.slice(index + 1) };
}

export const telemetryExperimentCommand = defineCommand({
  name: "experiment",
  description: "Plan a retention A/B experiment from scenario variants: sample size, observation window and assignment",
  options: {
    day: option(z.coerce.number().int().default(7), { description: "Retention day to test (1, 7, 30 or 90)" }),
    "baseline-rate": option(z.coerce.number().gt(0).lt(1).optional(), { description: "Control retention (default: control scenario's assumption for --day)" }),
    "mde-pp": option(z.coerce.number().gt(0).lt(100).optional(), { description: "Minimum detectable effect in percentage points (default: smallest assumed difference between variants)" }),
    alpha,
    power: option(z.coerce.number().gt(0).lt(1).default(0.8), { description: "Statistical power" }),
    "daily-installs": option(z.coerce.number().positive().optional(), { description: "Eligible new installs per day across all groups" }),
    "experiment-id": option(z.string().min(1).default("retention-experiment"), { description: "Experiment id used as the assignment hash salt" }),
    out, format: outputFormat,
  },
  async handler({ flags, positional }) {
    if (positional.length < 2) throw usageError("Usage: idk telemetry experiment <control>=<scenario.json> <treatment>=<scenario.json> [...] [--day 7] [--mde-pp 2]");
    const variants = positional.map(parseVariant);
    const key = `d${flags.day}` as "d1" | "d7" | "d30" | "d90";
    const groups: ExperimentGroupInput[] = [];
    for (const variant of variants) {
      const assumptions = scenarioRetentionAssumptions(await readScenarioFile(variant.path), variant.path);
      groups.push({ id: variant.id, scenario: variant.path, ...(assumptions[key] !== undefined ? { retention: assumptions[key] } : {}) });
    }
    let plan: ReturnType<typeof planRetentionExperiment>;
    try {
      plan = planRetentionExperiment({
        groups, retentionDay: flags.day, baselineRate: flags["baseline-rate"], minimumDetectableEffectPercentagePoints: flags["mde-pp"],
        alpha: flags.alpha, power: flags.power, dailyInstalls: flags["daily-installs"],
      });
    } catch (error) { throw usageError(error instanceof Error ? error.message : String(error)); }
    const assignment = {
      experimentId: flags["experiment-id"],
      groups: groups.map(group => group.id),
      method: "assignExperimentGroup(userId, experimentId, groups): FNV-1a 32-bit of experimentId + NUL + userId, modulo the group count",
    };
    await writeOutput({
      format: flags.format, outPath: flags.out, protectedInputs: variants.map(variant => resolve(variant.path)),
      data: flags.format === "md" ? `${renderExperimentMarkdown(plan, flags["experiment-id"])}\n\nAssignment: ${assignment.method}. Groups in order: ${assignment.groups.join(", ")}.` : { ok: true, plan, assignment },
      meta: buildOutputMeta({ command: "telemetry.experiment" }),
    });
  },
});
