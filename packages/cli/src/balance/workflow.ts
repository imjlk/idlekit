import { runScenario, validateScenarioV1 } from "@idlekit/core";
import { resolve, dirname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { CLI_VERSION } from "../cliMeta";
import { loadRegistriesFromFlags, type PluginOptionFlags } from "../commands/_shared/plugin";
import { prepareResolvedRun } from "../lib/runConfiguration";
import { planPacingRuns, runPacingChecks } from "./pacing";
import { applySheetCsv, exportSheetCsv, parseCsv, stringifyCsv, validateSheetSchema, refreshSheetBundle, readCurrentBundle, SHEET_LIMITS, type SheetSchema, type SheetBundleManifest, type SheetBundleStatus } from "./sheet";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/);
const metricSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("firstAction"), actionId: z.string().min(1).max(200) }).strict(),
  z.object({ id, kind: z.literal("firstActionPrefix"), prefix: z.string().min(1).max(200) }).strict(),
  z.object({ id, kind: z.enum(["endWallet", "endNetWorth", "prestigeCount", "actionCount"]) }).strict(),
]);
const workflowSchema = z.object({
  version: z.literal(1),
  sheet: z.string().min(1),
  schema: z.string().min(1),
  scenario: z.string().min(1),
  outputDir: z.string().min(1),
  pacing: z.record(z.string(), z.unknown()),
  metrics: z.array(metricSchema).min(1).max(100),
  bindings: z.array(z.object({
    field: id,
    path: z.enum(["initial.wallet.amount", "sim.offline.maxSec"]),
  }).strict()).max(2).default([]),
}).strict();

export type BalanceWorkflow = z.infer<typeof workflowSchema>;
const MAX_STEPS_PER_RUN = 100_000;
const MAX_TOTAL_STEPS = 1_000_000;

function parametersFromCsv(csv: string): Record<string, number> {
  const rows = parseCsv(csv);
  const header = rows[0]!;
  const idColumn = header.indexOf("id");
  const valueColumn = header.indexOf("value");
  return Object.fromEntries(rows.slice(1).map((row) => [row[idColumn]!, Number(row[valueColumn])]));
}

function overlayCsv(csv: string, patches: Readonly<Record<string, number>>): string {
  const rows = parseCsv(csv);
  const header = rows[0]!;
  const idColumn = header.indexOf("id");
  const valueColumn = header.indexOf("value");
  for (const row of rows.slice(1)) row[valueColumn] = String(patches[row[idColumn]!]!);
  return stringifyCsv(rows);
}

function bindInputs(document: unknown, schema: SheetSchema, config: BalanceWorkflow, values: Readonly<Record<string, number>>): void {
  const target = document as { unit?: { code: string }; initial?: { wallet?: { unit: string; amount?: string } }; sim?: { offline?: { maxSec?: number } } };
  const seen = new Set<string>();
  for (const binding of config.bindings) {
    if (seen.has(binding.path)) throw new Error(`Duplicate binding: ${binding.path}`);
    seen.add(binding.path);
    const value = values[binding.field];
    if (value === undefined) throw new Error(`Unknown binding field: ${binding.field}`);
    const field = schema.fields.find((item) => item.id === binding.field)!;
    if (binding.path === "initial.wallet.amount") {
      if (!target.initial?.wallet) throw new Error("initial.wallet binding destination is missing");
      if (field.unit !== target.unit?.code || field.unit !== target.initial.wallet.unit) throw new Error("Wallet binding unit must match the scenario currency");
      target.initial.wallet.amount = String(value);
    } else {
      if (!target.sim?.offline) throw new Error("sim.offline binding destination is missing");
      if (field.unit !== "seconds") throw new Error("Offline cap binding unit must be seconds");
      target.sim.offline.maxSec = value;
    }
  }
}

function normalizeRunDocument(document: unknown, strategy: string, horizon: number): void {
  const target = document as {
    clock: { durationSec?: number; untilExpr?: string };
    strategy?: { id: string; params?: unknown };
    sim?: { fast?: boolean; eventLog?: { enabled: boolean } };
    outputs?: { report?: { includeTrace?: boolean; traceEverySteps?: number } };
  };
  target.clock.durationSec = horizon;
  delete target.clock.untilExpr;
  if (target.strategy?.id !== strategy) target.strategy = { id: strategy };
  target.sim = { ...target.sim, fast: false, eventLog: { enabled: false } };
  target.outputs = { ...target.outputs, report: { ...target.outputs?.report, includeTrace: true, traceEverySteps: MAX_STEPS_PER_RUN + 1 } };
}

/** Explicit refresh only: no spreadsheet macros, formula execution, or background watcher. */
export function refreshBalanceWorkflow(configPath: string, flags: PluginOptionFlags, check: true): Promise<SheetBundleStatus>;
export function refreshBalanceWorkflow(configPath: string, flags: PluginOptionFlags, check?: false): Promise<SheetBundleManifest & { outcome: { ok: boolean; status: string } }>;
export function refreshBalanceWorkflow(configPath: string, flags: PluginOptionFlags, check: boolean): Promise<SheetBundleStatus | (SheetBundleManifest & { outcome: { ok: boolean; status: string } })>;
export async function refreshBalanceWorkflow(configPath: string, flags: PluginOptionFlags, check = false) {
  const absoluteConfig = resolve(configPath);
  const configInfo = await stat(absoluteConfig);
  if (!configInfo.isFile() || configInfo.size > SHEET_LIMITS.maxInputBytes) throw new Error("Workflow config is not a bounded regular file");
  const rawConfig = await readFile(absoluteConfig, "utf8");
  const config = workflowSchema.parse(JSON.parse(rawConfig));
  const base = dirname(absoluteConfig);
  const inputFiles: Record<string, string> = {
    config: absoluteConfig,
    sheet: resolve(base, config.sheet),
    schema: resolve(base, config.schema),
    scenario: resolve(base, config.scenario),
  };
  if (flags["plugin-trust-file"]) inputFiles.pluginTrust = resolve(flags["plugin-trust-file"]);
  const loaded = await loadRegistriesFromFlags(flags);
  for (const [index, path] of Object.keys(loaded.pluginDigest).entries()) inputFiles[`plugin${index}`] = path;
  const context = { cliVersion: CLI_VERSION, bunVersion: Bun.version, pluginDigests: JSON.stringify(loaded.pluginDigest), engine: "number" };
  const outputDir = resolve(base, config.outputDir);
  if (check) return readCurrentBundle(outputDir, inputFiles, { context });

  let outcome: { ok: boolean; status: string } | undefined;
  const manifest = await refreshSheetBundle({
    inputFiles,
    outputDir,
    context,
    beforeCommit: async () => {
      const latest = await loadRegistriesFromFlags(flags);
      if (JSON.stringify(latest.pluginDigest) !== context.pluginDigests) throw new Error("Plugin sources changed during refresh; rerun in a fresh process");
    },
    compute: async (snapshot) => {
      if (snapshot.text("config") !== rawConfig) throw new Error("Workflow config changed before snapshot; rerun");
      const template: unknown = JSON.parse(snapshot.text("scenario"));
      const schema = validateSheetSchema(JSON.parse(snapshot.text("schema")), template);
      for (const field of schema.fields) {
        if (!field.path.startsWith("/model/params/")) throw new Error("Balance fields must address /model/params/ numeric parameters");
      }
      const sourceCsv = snapshot.text("sheet");
      const scenario = applySheetCsv(template, schema, sourceCsv);
      const canonicalCsv = exportSheetCsv(scenario, schema, sourceCsv);
      const parameters = parametersFromCsv(canonicalCsv);
      if ("parameters" in config.pacing) throw new Error("pacing.parameters is forbidden: the CSV is authoritative");
      const pacing = { ...config.pacing, parameters };
      const plan = planPacingRuns(pacing);
      const metricIds = new Set(config.metrics.map((metric) => metric.id));
      if (metricIds.size !== config.metrics.length) throw new Error("Metric IDs must be unique");
      const targets = (config.pacing.targets as Array<{ metric: string }> | undefined) ?? [];
      for (const target of targets) if (!metricIds.has(target.metric)) throw new Error(`Unknown target metric: ${target.metric}`);
      const step = (scenario as { clock?: { stepSec?: number } }).clock?.stepSec;
      const horizon = Number(config.pacing.horizonSec);
      if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) throw new Error("Scenario clock.stepSec must be positive and finite");
      const steps = Math.ceil(horizon / step);
      const runCount = plan.runs.length;
      if (steps > MAX_STEPS_PER_RUN || steps * runCount > MAX_TOTAL_STEPS) {
        throw new Error(`Balance step budget exceeded (${MAX_STEPS_PER_RUN}/run, ${MAX_TOTAL_STEPS} total)`);
      }
      const baseline = structuredClone(scenario);
      bindInputs(baseline, schema, config, parameters);
      normalizeRunDocument(baseline, plan.strategy, horizon);
      const baselineDocument = baseline as { unit: { code: string } };
      for (const target of targets) {
        const metric = config.metrics.find((item) => item.id === target.metric)!;
        const unit = metric.kind === "firstAction" || metric.kind === "firstActionPrefix"
          ? "seconds" : metric.kind === "endWallet" || metric.kind === "endNetWorth" ? baselineDocument.unit.code : "count";
        if ((target as { unit?: string }).unit !== unit) throw new Error(`Target ${target.metric} must use unit '${unit}'`);
      }
      const report = await runPacingChecks(pacing, (descriptor, patches) => {
        const candidate = applySheetCsv(template, schema, overlayCsv(canonicalCsv, patches));
        bindInputs(candidate, schema, config, patches);
        normalizeRunDocument(candidate, descriptor.strategy, descriptor.horizonSec);
        const valid = validateScenarioV1(candidate, loaded.modelRegistry);
        if (!valid.ok || !valid.scenario) throw new Error(`Scenario validation failed: ${JSON.stringify(valid.issues)}`);
        const prepared = prepareResolvedRun({
          scenario: valid.scenario,
          modelRegistry: loaded.modelRegistry,
          strategyRegistry: loaded.strategyRegistry,
          pluginDigest: loaded.pluginDigest,
          engineRequest: "number",
          seed: descriptor.seed,
        });
        // Match `idk simulate --seed N` and hold the initial RNG stream constant across variants.
        const opened = prepared.open("simulate", `simulate:${descriptor.seed}`, { durationSec: descriptor.horizonSec });
        const run = runScenario({
          ...opened.scenario,
          run: {
            ...opened.scenario.run,
            durationSec: descriptor.horizonSec,
            maxSteps: steps + 1,
            until: undefined,
            fast: { enabled: false },
            trace: { everySteps: MAX_STEPS_PER_RUN + 1, maxPoints: 2, maxActions: MAX_STEPS_PER_RUN, keepActionsLog: true },
            eventLog: { enabled: false },
          },
        });
        if (run.stop?.reason === "budget") throw new Error("Simulation exhausted its step budget before the requested horizon");
        if ((run.actionsLogMeta?.dropped ?? 0) > 0) throw new Error("Action history exceeded the result budget; pacing cannot be inferred from truncated history");
        const actions = run.actionsLog ?? [];
        const result: Record<string, number | null> = {};
        for (const metric of config.metrics) {
          if (metric.kind === "firstAction" || metric.kind === "firstActionPrefix") {
            const action = actions.find((item) => metric.kind === "firstAction" ? item.actionId === metric.actionId : item.actionId.startsWith(metric.prefix));
            result[metric.id] = action ? action.elapsedSec ?? action.t - opened.scenario.initial.t : null;
          }
          else if (metric.kind === "prestigeCount") result[metric.id] = run.end.prestige.count;
          else if (metric.kind === "actionCount") result[metric.id] = actions.length;
          else if (metric.kind === "endWallet") result[metric.id] = Number(run.end.wallet.money.amount);
          else {
            const worth = opened.scenario.model.netWorth?.(opened.scenario.ctx, run.end);
            if (!worth) throw new Error("endNetWorth requires model.netWorth; wallet is not a substitute");
            result[metric.id] = Number(worth.amount);
          }
        }
        return result;
      });
      outcome = { ok: report.ok, status: report.status };
      const resultRows: string[][] = [["variant", "seed", "strategy", "horizonSec", "metric", "unit", "min", "max", "value", "status", "message"]];
      for (const entry of report.runs) for (const result of entry.results) resultRows.push([
        entry.run.variantId, String(entry.run.seed), entry.run.strategy, String(entry.run.horizonSec), result.metric, result.unit,
        result.min === undefined ? "" : String(result.min), result.max === undefined ? "" : String(result.max),
        result.value === null ? "" : String(result.value), result.status, result.message ?? "",
      ]);
      return {
        "scenario.json": JSON.stringify(baseline, null, 2) + "\n",
        "inputs.csv": canonicalCsv,
        "results.csv": stringifyCsv(resultRows),
        "results.json": JSON.stringify(report, null, 2) + "\n",
        "provenance.json": JSON.stringify({ version: 1, inputFingerprint: snapshot.inputFingerprint, inputs: snapshot.inputs, context, trialIdTemplate: "simulate:<seed>", stepSec: step, runCount, maxStepsPerRun: MAX_STEPS_PER_RUN, maxTotalSteps: MAX_TOTAL_STEPS, maxRetainedActions: MAX_STEPS_PER_RUN, maxTracePoints: 2 }, null, 2) + "\n",
      };
    },
  });
  return { ...manifest, outcome: outcome! };
}
