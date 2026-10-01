import { defineCommand, option } from "../runtime/command";
import {
  analyzerSemantics,
  assertAnalyzerPluginsPermitted,
  compileScenario,
  createNumberEngine,
  createRunFactory,
  observationContract,
  runEtaAnalyzer,
  runGrowthAnalyzer,
  runScenario,
  validateScenarioV1,
  type AnalyzerResult,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

function requestedPluginPaths(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export default defineCommand({
  name: "analyze",
  description: "Run one registered analyzer without replacing eta, growth, or prestige-cycle",
  options: {
    ...pluginOptions(),
    // Gunshi reserves --version for the CLI version, so the analyzer version has its own flag.
    "analyzer-version": option(z.string().default("1"), { description: "Analyzer version" }),
    window: option(z.coerce.number().default(60), { description: "Growth window sec" }),
    series: option(z.enum(["money", "netWorth"]).default("money"), { description: "Growth series" }),
    "trace-every": option(z.coerce.number().default(1), { description: "Trace every N steps" }),
    "target-money": option(z.string().optional(), { description: "ETA target money NumStr" }),
    "target-worth": option(z.string().optional(), { description: "ETA target net worth NumStr" }),
    mode: option(z.enum(["simulate", "analytic"]).default("simulate"), { description: "ETA mode" }),
    "max-duration": option(z.coerce.number().default(86400), { description: "ETA max duration sec" }),
    "budget-runs": option(z.coerce.number().default(1), { description: "Explicit fresh-run budget" }),
    "budget-duration": option(z.coerce.number().default(86400), { description: "Explicit duration budget sec" }),
    "budget-samples": option(z.coerce.number().default(100000), { description: "Explicit sample budget" }),
    params: option(z.string().default("{}"), { description: "JSON params for a custom analyzer" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const analyzerId = positional[0];
    if (!analyzerId) throw usageError("Usage: idk analyze <id> [scenario]");
    assertAnalyzerPluginsPermitted(flags["allow-plugin"], requestedPluginPaths(flags.plugin));
    const loaded = await loadRegistriesFromFlags(flags);
    const version = flags["analyzer-version"];
    const scenarioPath = positional[1];

    if (analyzerId === "growth" && version === "1") {
      if (!scenarioPath) throw usageError("Usage: idk analyze growth <scenario>");
      const result = await runGrowth(scenarioPath, flags, loaded);
      await emit(flags, result, scenarioPath, loaded);
      return;
    }
    if (analyzerId === "eta" && version === "1") {
      if (!scenarioPath) throw usageError("Usage: idk analyze eta <scenario> --target-money <NumStr> | --target-worth <NumStr>");
      const result = await runEta(scenarioPath, flags, loaded);
      await emit(flags, result, scenarioPath, loaded);
      return;
    }

    let params: unknown = {};
    try {
      params = JSON.parse(flags.params);
    } catch {
      throw usageError("Analyzer --params must be JSON");
    }
    const defined = loaded.analyzerRegistry.get(analyzerId, version);
    if (!defined) {
      const failure = loaded.analyzerFailures.find((item) => item.message.includes(analyzerId));
      throw usageError(failure ? `Analyzer ${analyzerId}@${version} failed to load: ${failure.message}` : `Unknown analyzer ${analyzerId}@${version}`);
    }
    const batch = loaded.analyzerRegistry.run({
      requests: [{ id: analyzerId, version, params }],
      semantics: analyzerSemantics(),
      allowExecution: false,
    });
    const result = batch.results[0];
    if (!result) throw usageError(`Analyzer ${analyzerId}@${version} produced no result`);
    await emit(flags, result, scenarioPath, loaded);
  },
});

async function runGrowth(
  scenarioPath: string,
  flags: {
    window: number;
    series: "money" | "netWorth";
    "trace-every": number;
  },
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>,
) {
  const compiled = await compile(scenarioPath, loaded);
  const run = runScenario({
    ...compiled.compiled,
    run: {
      ...compiled.compiled.run,
      trace: { everySteps: Math.max(1, flags["trace-every"]), keepActionsLog: false },
    },
  });
  return runGrowthAnalyzer({
    run,
    scenario: compiled.compiled,
    series: flags.series,
    windowSec: flags.window,
    supply: {
      schema: observationContract,
      windowSec: flags.window,
      sampleCadenceSec: Math.max(1, flags["trace-every"]) * compiled.compiled.run.stepSec,
      coverage: "trace",
      metricIds: [flags.series],
    },
  });
}

async function runEta(
  scenarioPath: string,
  flags: {
    "target-money"?: string;
    "target-worth"?: string;
    mode: "simulate" | "analytic";
    "max-duration": number;
    "budget-runs": number;
    "budget-duration": number;
    "budget-samples": number;
  },
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>,
) {
  const targetMoney = flags["target-money"];
  const targetWorth = flags["target-worth"];
  if ((targetMoney ? 1 : 0) + (targetWorth ? 1 : 0) !== 1) {
    throw usageError("Exactly one target is required: --target-money or --target-worth");
  }
  const compiled = await compile(scenarioPath, loaded);
  return runEtaAnalyzer({
    scenario: compiled.compiled,
    target: targetMoney
      ? { kind: "money", value: targetMoney }
      : { kind: "netWorth", value: targetWorth! },
    mode: flags.mode,
    maxDurationSec: flags["max-duration"],
    budget: {
      maxFreshRuns: flags["budget-runs"],
      maxDurationSec: flags["budget-duration"],
      maxSamples: flags["budget-samples"],
    },
    runFactory: createRunFactory(),
  });
}

async function compile(scenarioPath: string, loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>) {
  const input = await readScenarioFile(scenarioPath);
  const valid = validateScenarioV1(input, loaded.modelRegistry);
  if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);
  const compiled = compileScenario<number, string, Record<string, unknown>>({
    E: createNumberEngine(),
    scenario: valid.scenario,
    registry: loaded.modelRegistry,
    strategyRegistry: loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  return { compiled, scenario: valid.scenario };
}

async function emit(
  flags: { format: "json" | "md"; out?: string },
  result: AnalyzerResult,
  scenarioPath: string | undefined,
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>,
): Promise<void> {
  const input = scenarioPath ? await readScenarioFile(scenarioPath) : undefined;
  const valid = input ? validateScenarioV1(input, loaded.modelRegistry) : undefined;
  await writeOutput({
    format: flags.format,
    outPath: flags.out,
    data: result,
    meta:
      flags.format === "json" && valid?.scenario
        ? buildOutputMeta({ command: "analyze", scenarioPath, scenario: valid.scenario })
        : undefined,
  });
}
