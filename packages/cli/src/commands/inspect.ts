import { defineCommand, option } from "../runtime/command";
import {
  assertAnalyzerPluginsPermitted,
  buildScenarioInspect,
  validateScenarioV1,
  type ScenarioInspectReport,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions, type PluginOptionFlags } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { prepareResolvedRun, type ResolvedRunPlan } from "../lib/runConfiguration";

function requestedPluginPaths(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function collectDecimals(value: unknown, out: string[]): void {
  if (typeof value === "string" && /^-?\d/.test(value)) out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectDecimals(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectDecimals(item, out);
  }
}

function stageInput(plan: ResolvedRunPlan) {
  return {
    name: plan.stage.name,
    applies: plan.stage.applies,
    stepSec: plan.stepSec,
    strategyId: plan.strategy.id,
    strategySource: plan.strategy.source,
    ...(plan.session ? { session: plan.session } : {}),
  };
}

function plannerParams(plan: ResolvedRunPlan) {
  if (plan.strategy.id !== "planner" || !plan.strategy.params || typeof plan.strategy.params !== "object") return null;
  const params = plan.strategy.params as {
    horizonSteps?: unknown;
    beamWidth?: unknown;
    maxBranchingActions?: unknown;
  };
  if (typeof params.horizonSteps !== "number") return null;
  return {
    horizonSteps: params.horizonSteps,
    ...(typeof params.beamWidth === "number" ? { beamWidth: params.beamWidth } : {}),
    ...(typeof params.maxBranchingActions === "number" ? { maxBranchingActions: params.maxBranchingActions } : {}),
  };
}

function renderInspectMarkdown(report: ScenarioInspectReport): string {
  const simulate = report.stages.find((stage) => stage.name === "simulate");
  const lines = [
    "# Scenario inspect",
    "",
    "This is not doctor. The plan was not ticked.",
    "",
    `- Contract: ${report.contract}`,
    `- Engine: ${report.engine.effectiveId}`,
    `- Reason: ${report.engine.reason}`,
    `- Model: ${report.model.id}@${report.model.version}`,
    `- Simulate step: ${simulate?.stepSec.value ?? "unknown"} from ${simulate?.stepSec.source ?? "unknown"}`,
    `- Simulate steps: ${String(simulate?.stepCount ?? "unknown")}`,
  ];
  if (report.planner) {
    lines.push(`- Planner expansion upper bound: ${report.planner.expansionUpperBound}. This is not a measured duration.`);
  }
  for (const item of report.diagnostics) lines.push(`- ${item.severity} ${item.code}`);
  return lines.join("\n");
}

export default defineCommand({
  name: "inspect",
  description: "Explain the resolved run plan without ticking, judging, or using the network",
  options: {
    ...pluginOptions(),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output path" }),
    engine: option(z.string().min(1).optional(), {
      description: "Execution engine. Default number. scenario.engine is metadata. breakInfinity is explicit. breakEternity is unsupported.",
    }),
    strategy: option(z.string().min(1).optional(), { description: "Registered strategy id" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec for stages that apply step" }),
    // Same as simulate: an omitted flag keeps the scenario's fast setting, and false disables it.
    fast: option(z.coerce.boolean().optional(), {
      description: "Override fast mode where the stage applies it (omitted: scenario setting)",
    }),
    "consistent-overrides": option(z.coerce.boolean().default(false), {
      description: "Also apply step and fast overrides on the experience stage",
    }),
    "resolve-plugins": option(z.coerce.boolean().default(false), {
      description: "Load trusted plugin modules. Import may run user code. Default is not to load plugins.",
    }),
    "session-id": option(z.string().optional(), { description: "Session pattern id for stages that apply session" }),
    days: option(z.coerce.number().optional(), { description: "Session days for stages that apply session" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) throw usageError("Usage: idk inspect <scenario.(json|yaml)> [--format json|md]");
    const paths = requestedPluginPaths(flags.plugin);
    const resolvePlugins = flags["resolve-plugins"] && paths.length > 0;
    if (resolvePlugins) assertAnalyzerPluginsPermitted(flags["allow-plugin"], paths);
    const silentFlags: PluginOptionFlags = { ...flags, plugin: "" };
    const builtins = await loadRegistriesFromFlags(silentFlags);
    const loaded = resolvePlugins ? await loadRegistriesFromFlags(flags) : builtins;
    const builtinIds = new Set(builtins.modelRegistry.list().map((item) => `${item.id}@${item.version}`));
    const loadedIds = loaded.modelRegistry
      .list()
      .filter((item) => !builtinIds.has(`${item.id}@${item.version}`))
      .map((item) => `${item.id}@${item.version}`);
    const input = await readScenarioFile(scenarioPath);
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);
    const scenario = valid.scenario;
    const decimals: string[] = [];
    collectDecimals(scenario, decimals);

    const base = {
      model: { id: scenario.model.id, version: scenario.model.version },
      unitCode: scenario.unit.code,
      walletUnit: scenario.initial.wallet.unit,
      clock: {
        stepSec: scenario.clock.stepSec,
        ...(scenario.clock.durationSec !== undefined ? { durationSec: scenario.clock.durationSec } : {}),
        ...(scenario.clock.untilExpr ? { untilExpr: scenario.clock.untilExpr } : {}),
      },
      ...(scenario.sim?.offline ? { offline: scenario.sim.offline } : {}),
      ...(scenario.sim?.eventLog ? { eventLog: scenario.sim.eventLog } : {}),
      trace: {
        include: scenario.outputs?.report?.includeTrace === true,
        ...(scenario.outputs?.report?.traceEverySteps !== undefined
          ? { everySteps: scenario.outputs.report.traceEverySteps }
          : {}),
      },
      capabilities: {
        metrics: "unknown" as const,
        goals: "unknown" as const,
        reset: "unknown" as const,
        flow: "unknown" as const,
        advance: "unknown" as const,
      },
      analyzers: loaded.analyzerRegistry.list().flatMap((item) => {
        const defined = loaded.analyzerRegistry.get(item.id, item.version);
        if (!defined) return [];
        return [{ id: defined.id, version: defined.version, kind: defined.kind, observation: defined.observation }];
      }),
      decimals,
      prestigeRequested: scenario.analysis?.prestigeCycle !== undefined,
      plugins: {
        resolve: resolvePlugins,
        requested: paths.length > 0,
        loadedIds,
      },
    };

    try {
      const prepared = prepareResolvedRun({
        scenario,
        modelRegistry: loaded.modelRegistry,
        strategyRegistry: loaded.strategyRegistry,
        pluginDigest: loaded.pluginDigest,
        engineRequest: flags.engine,
        strategyOverride: flags.strategy,
        stepSec: flags.step,
        fast: flags.fast,
        consistentOverrides: flags["consistent-overrides"],
        sessionId: flags["session-id"],
        days: flags.days,
      });
      const simulate = prepared.planFor("simulate");
      const experience = prepared.planFor("experience");
      const report = buildScenarioInspect({
        ...base,
        engine: {
          effectiveId: prepared.engine.effectiveId,
          source: prepared.engine.source,
          accepted: true,
          ...(prepared.engine.scenarioEngine ? { scenarioEngine: prepared.engine.scenarioEngine } : {}),
        },
        stages: [stageInput(simulate), stageInput(experience)],
        planner: plannerParams(simulate),
      });
      await emit(flags, report, scenarioPath, scenario);
    } catch (error) {
      const message = error instanceof Error ? error.message : "engine rejected";
      const rejected = message.includes("Unknown engine") || message.includes("breakEternity");
      if (!rejected) throw error;
      const report = buildScenarioInspect({
        ...base,
        engine: { effectiveId: flags.engine ?? "rejected", source: "rejected", accepted: false, rejectReason: message },
        stages: [],
        planner: null,
      });
      await emit(flags, report, scenarioPath, scenario);
      throw cliError("UNSUPPORTED_ENGINE", message);
    }
  },
});

async function emit(
  flags: { format: "json" | "md"; out?: string },
  report: ScenarioInspectReport,
  scenarioPath: string,
  scenario: unknown,
): Promise<void> {
  if (flags.format === "md") {
    const body = renderInspectMarkdown(report);
    if (!flags.out) {
      console.log(body);
      return;
    }
  }
  await writeOutput({
    format: flags.format === "md" ? "md" : "json",
    outPath: flags.out,
    data: flags.format === "md" ? renderInspectMarkdown(report) : report,
    meta: flags.format === "json" ? buildOutputMeta({ command: "inspect", scenarioPath, scenario }) : undefined,
  });
}
