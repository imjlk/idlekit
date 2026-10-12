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
  type AnalyzerBudget,
  type AnalyzerDefinition,
  type AnalyzerResult,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

type Loaded = Awaited<ReturnType<typeof loadRegistriesFromFlags>>;
type Compiled = Awaited<ReturnType<typeof compile>>;

function requestedPluginPaths(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function budgetFromFlags(flags: {
  "budget-runs": number;
  "budget-duration": number;
  "budget-samples": number;
}): AnalyzerBudget {
  return {
    maxFreshRuns: flags["budget-runs"],
    maxDurationSec: flags["budget-duration"],
    maxSamples: flags["budget-samples"],
  };
}

function runFactoryFor(loaded: Loaded) {
  return createRunFactory({ models: loaded.modelRegistry, strategies: loaded.strategyRegistry });
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
    "trace-every": option(z.coerce.number().int().min(1).default(1), { description: "Trace every N steps" }),
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
      const compiled = await compile(scenarioPath, loaded);
      await emit(flags, runGrowth(compiled, flags), scenarioPath, compiled, loaded);
      return;
    }
    if (analyzerId === "eta" && version === "1") {
      if (!scenarioPath) throw usageError("Usage: idk analyze eta <scenario> --target-money <NumStr> | --target-worth <NumStr>");
      const target = etaTarget(flags);
      const compiled = await compile(scenarioPath, loaded);
      await emit(flags, runEta(compiled, target, flags, loaded), scenarioPath, compiled, loaded);
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
    // `idk analyze <id>` is an explicit request, like `idk analyze eta`: an execution analyzer
    // runs inside the --budget-* flags, with the compiled scenario when one is given.
    // A postprocess analyzer reads a run, so the scenario is run once with a trace and supplied as input.
    const compiled = scenarioPath ? await compile(scenarioPath, loaded) : undefined;
    const observed =
      compiled && readsObservation(loaded, defined) ? observeScenario(compiled, flags["trace-every"]) : undefined;
    const batch = loaded.analyzerRegistry.run({
      requests: [{ id: analyzerId, version, params }],
      semantics: compiled ? scenarioSemantics(compiled, flags["max-duration"]) : analyzerSemantics(),
      ...(observed ? { supply: observed.supply, input: { run: observed.run, scenario: compiled?.compiled } } : {}),
      scenario: compiled?.compiled ?? null,
      budget: budgetFromFlags(flags),
      runFactory: runFactoryFor(loaded),
      allowExecution: true,
    });
    const result = batch.results.find((item) => item.id === analyzerId && item.version === version);
    if (!result) throw usageError(`Analyzer ${analyzerId}@${version} produced no result`);
    await emit(flags, result, scenarioPath, compiled, loaded);
  },
});

/** True when the analyzer or any dependency the registry will pull in is a postprocess analyzer. */
function readsObservation(loaded: Loaded, root: AnalyzerDefinition<unknown>): boolean {
  const seen = new Set<AnalyzerDefinition<unknown>>();
  const pending = [root];
  while (pending.length > 0) {
    const definition = pending.pop()!;
    if (seen.has(definition)) continue;
    seen.add(definition);
    if (definition.kind === "postprocess") return true;
    for (const dependency of definition.dependencies) {
      const next = loaded.analyzerRegistry.get(dependency.id, dependency.version);
      if (next) pending.push(next);
    }
  }
  return false;
}

function scenarioSemantics(compiled: Compiled, fallbackHorizonSec: number) {
  return analyzerSemantics({
    strategyKey: compiled.scenario.strategy?.id ?? "none",
    horizonSec: compiled.compiled.run.durationSec ?? fallbackHorizonSec,
    stepSec: compiled.compiled.run.stepSec,
    seed: compiled.compiled.ctx.seed ?? null,
  });
}

function tracedRun(compiled: Compiled, traceEvery: number) {
  return runScenario({
    ...compiled.compiled,
    run: {
      ...compiled.compiled.run,
      trace: { everySteps: Math.max(1, traceEvery), keepActionsLog: false },
    },
  });
}

/** One traced run. Its trace cadence is also the finest window it can supply. */
function observeScenario(compiled: Compiled, traceEvery: number) {
  const cadence = Math.max(1, traceEvery) * compiled.compiled.run.stepSec;
  return {
    run: tracedRun(compiled, traceEvery),
    supply: {
      schema: observationContract,
      windowSec: cadence,
      sampleCadenceSec: cadence,
      coverage: "trace" as const,
      metricIds: ["money", "netWorth"],
    },
  };
}

function runGrowth(
  compiled: Compiled,
  flags: {
    window: number;
    series: "money" | "netWorth";
    "trace-every": number;
    "max-duration": number;
  },
) {
  const run = tracedRun(compiled, flags["trace-every"]);
  return runGrowthAnalyzer({
    run,
    scenario: compiled.compiled,
    series: flags.series,
    windowSec: flags.window,
    semantics: scenarioSemantics(compiled, flags["max-duration"]),
    supply: {
      schema: observationContract,
      windowSec: flags.window,
      sampleCadenceSec: Math.max(1, flags["trace-every"]) * compiled.compiled.run.stepSec,
      coverage: "trace",
      metricIds: [flags.series],
    },
  });
}

function etaTarget(flags: { "target-money"?: string; "target-worth"?: string }) {
  const targetMoney = flags["target-money"];
  const targetWorth = flags["target-worth"];
  if ((targetMoney ? 1 : 0) + (targetWorth ? 1 : 0) !== 1) {
    throw usageError("Exactly one target is required: --target-money or --target-worth");
  }
  return targetMoney
    ? { kind: "money" as const, value: targetMoney }
    : { kind: "netWorth" as const, value: targetWorth! };
}

function runEta(
  compiled: Compiled,
  target: ReturnType<typeof etaTarget>,
  flags: {
    mode: "simulate" | "analytic";
    "max-duration": number;
    "budget-runs": number;
    "budget-duration": number;
    "budget-samples": number;
  },
  loaded: Loaded,
) {
  return runEtaAnalyzer({
    scenario: compiled.compiled,
    target,
    mode: flags.mode,
    maxDurationSec: flags["max-duration"],
    // ETA simulates for max-duration, so that is its horizon; strategy, step, and seed come from the scenario.
    semantics: { ...scenarioSemantics(compiled, flags["max-duration"]), horizonSec: flags["max-duration"] },
    budget: budgetFromFlags(flags),
    runFactory: runFactoryFor(loaded),
  });
}

async function compile(scenarioPath: string, loaded: Loaded) {
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

/** The hash is of the scenario that was compiled and analyzed. The file is not read again. */
async function emit(
  flags: { format: "json" | "md"; out?: string },
  result: AnalyzerResult,
  scenarioPath: string | undefined,
  compiled: Compiled | undefined,
  loaded: Loaded,
): Promise<void> {
  await writeOutput({
    format: flags.format,
    outPath: flags.out,
    data: result,
    meta:
      flags.format === "json"
        ? buildOutputMeta({
            command: "analyze",
            ...(scenarioPath && compiled ? { scenarioPath, scenario: compiled.scenario } : {}),
            pluginDigest: loaded.pluginDigest,
          })
        : undefined,
  });
}
