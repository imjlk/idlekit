import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import type { CompiledScenario, RunResult } from "../types";
import { runScenario } from "../simulator";
import { createRunFactory, type RunFactory } from "../runFactory";
import { observationContract } from "../observation";
import { analyzeGrowth } from "./growth";
import { etaAnalytic, etaEstimateAlgorithmVersion, etaSimulate } from "./eta";
import { createModelAnalysisRegistry } from "./registry";
import {
  analyzerCustomRegistration,
  analyzerExecutionBudget,
  analyzerKey,
  analyzerInsufficientObservation,
  AnalyzerRegistryError,
  analyzerLocalOutput,
  analyzerModuleBoundaryIssues,
  analyzerNotJudge,
  analyzerObservationPlan,
  analyzerPluginIsolation,
  analyzerRegistryConflicts,
  analyzerResultMarkdown,
  analyzerSameAlgorithm,
  analyzerSemantics,
  assertAnalyzerPluginsPermitted,
  createAnalyzerRegistry,
  createBuiltinAnalyzerRegistry,
  executionPlanForDemand,
  growthAnalyzerAlgorithmVersion,
  observationDemand,
  observationMeets,
  registerAnalyzerIsolated,
  runEtaAnalyzer,
  runGrowthAnalyzer,
  type AnalyzerBudget,
  type AnalyzerDefinition,
  type ExecutionContext,
  type ObservationDemand,
  type RunSemantics,
} from "./analyzers";

function makeScenario(): CompiledScenario<number, string, Record<string, unknown>> {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: {
      id: "m",
      version: 1,
      income: () => ({ unit, amount: 1 }),
      actions: () => [],
    },
    initial: {
      t: 0,
      wallet: { money: { unit, amount: 0 }, bucket: 0 },
      maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: {},
    },
    run: { stepSec: 1, durationSec: 10 },
  };
}

function probe(args: Readonly<{
  id: string;
  version?: string;
  kind?: "postprocess" | "execution";
  dependencies?: readonly { id: string; version: string }[];
  capabilities?: AnalyzerDefinition["requires"]["capabilities"];
  metricIds?: readonly string[];
  observation?: ObservationDemand;
  acceptParams?: (input: unknown) => boolean;
  onPostprocess?: () => unknown;
  samples?: number;
  onExecute?: (ctx: ExecutionContext) => unknown;
}>): AnalyzerDefinition {
  const kind = args.kind ?? "postprocess";
  return {
    id: args.id,
    version: args.version ?? "1",
    kind,
    validateParams: (input) => {
      if (args.acceptParams && !args.acceptParams(input)) return { ok: false, issues: ["bad params"] };
      return { ok: true, params: input };
    },
    requires: {
      capabilities: args.capabilities ?? [],
      metricIds: args.metricIds ?? [],
      observationSchema: observationContract,
    },
    observation: args.observation ?? observationDemand(),
    outputContract: "test.analyzer",
    algorithmVersion: "test-v1",
    cost: { freshRuns: kind === "execution" ? 1 : 0, samples: args.samples ?? 1 },
    dependencies: args.dependencies ?? [],
    ...(kind === "postprocess"
      ? {
          postprocess: () => ({ status: "ok" as const, value: args.onPostprocess ? args.onPostprocess() : args.id }),
        }
      : {
          execute: (_params, ctx) => ({
            status: "ok" as const,
            value: args.onExecute
              ? args.onExecute(ctx)
              : args.id,
          }),
        }),
  };
}

const budget: AnalyzerBudget = { maxFreshRuns: 1, maxDurationSec: 10, maxSamples: 10 };
const sharedDemand = observationDemand({ coverage: "window", sampleCadenceSec: 2, metricIds: ["money"] });

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-registry-conflicts A duplicate, a cycle, a missing dependency, bad params, and an unsupported capability do not run the body.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-registry-conflicts #f1a5463 Re-read the section, then ran this function: the call log stays empty, flow is unsupported, an incomplete definition and a two-run cost are refused at register, base takes the semantics of left, and after.gate and after.short do not run.
 * @evidence ./analyzers.ts#analyzerRegistryConflicts Reads the conflict contract.
 * @evidenceReview ./analyzers.ts#analyzerRegistryConflicts #a1dbd92 The declaration is fail-before-run.
 * @evidence ./analyzers.ts#AnalyzerRegistryError.prototype.issues Reads the issue list stored when params fail before a body.
 * @evidenceReview ./analyzers.ts#AnalyzerRegistryError.prototype.issues #577e5a5 The field holds the validator issues on the thrown error.
 * @evidence ./analyzers.ts#createAnalyzerRegistry Rejects duplicate keys and dependency cycles before any run.
 * @evidenceReview ./analyzers.ts#createAnalyzerRegistry #2ae8007 The function validates each definition, rejects a duplicate key, removes a definition that closes a dependency cycle, lists sorted identities, and runs requests in dependency order.
 * @evidence ./analyzers.ts#analyzerSemantics Builds run semantics for the registry requests.
 * @evidenceReview ./analyzers.ts#analyzerSemantics #9bf6cad The function returns no session, no strategy, a 1 second horizon and step, a null seed, and the given overrides.
 * @evidence ./analyzers.ts#analyzerKey Reads the id@version key for a request.
 * @evidenceReview ./analyzers.ts#analyzerKey #16358d7 The function joins the id and version with @.
 */
export function rejectsRegistryConflictsBeforeRun(): void {
  const growthId = "growth";
  expect(analyzerKey(growthId, "1")).toBe("growth@1");
  expect(analyzerRegistryConflicts).toBe("fail-before-run");
  const calls: string[] = [];
  const registry = createAnalyzerRegistry();
  registry.register(probe({ id: "m", onPostprocess: () => calls.push("m") }));
  expect(() => registry.register(probe({ id: "m" }))).toThrow("duplicate analyzer m@1");
  expect(() =>
    registry.register(probe({ id: "loop", dependencies: [{ id: "m", version: "1" }] })),
  ).not.toThrow();
  const cyclic = createAnalyzerRegistry();
  cyclic.register(probe({ id: "a", dependencies: [{ id: "b", version: "1" }] }));
  expect(() => cyclic.register(probe({ id: "b", dependencies: [{ id: "a", version: "1" }] }))).toThrow(
    "dependency cycle",
  );
  expect(cyclic.list().map((item) => item.id)).toEqual(["a"]);

  const missing = createAnalyzerRegistry();
  missing.register(probe({ id: "child", dependencies: [{ id: "parent", version: "1" }], onPostprocess: () => calls.push("child") }));
  expect(() =>
    missing.run({ requests: [{ id: "child", version: "1", params: {} }], semantics: analyzerSemantics() }),
  ).toThrow("missing dependency parent@1");

  const invalid = createAnalyzerRegistry();
  invalid.register(probe({ id: "params", acceptParams: (input) => input === "ok", onPostprocess: () => calls.push("params") }));
  let invalidError: unknown;
  try {
    invalid.run({ requests: [{ id: "params", version: "1", params: "no" }], semantics: analyzerSemantics() });
  } catch (error) {
    invalidError = error;
  }
  expect(invalidError).toBeInstanceOf(AnalyzerRegistryError);
  if (!(invalidError instanceof AnalyzerRegistryError)) throw invalidError;
  expect(invalidError.message).toContain("bad params");
  expect(invalidError.issues).toEqual(["bad params"]);

  const unsupported = createAnalyzerRegistry();
  unsupported.register(
    probe({
      id: "flow",
      capabilities: ["flow"],
      onPostprocess: () => calls.push("flow"),
    }),
  );
  const refused = unsupported.run({
    requests: [{ id: "flow", version: "1", params: {} }],
    semantics: analyzerSemantics(),
    capabilities: { flow: "unsupported" },
  });
  expect(refused.results[0]?.status).toBe("unsupported");
  expect(calls).toEqual([]);

  const ordered = createAnalyzerRegistry();
  ordered.register(probe({ id: "m", onPostprocess: () => calls.push("m") }));
  ordered.register(probe({ id: "a", dependencies: [{ id: "m", version: "1" }], onPostprocess: () => calls.push("a") }));
  const batch = ordered.run({
    requests: [
      { id: "a", version: "1", params: {} },
      { id: "m", version: "1", params: {} },
    ],
    semantics: analyzerSemantics(),
  });
  expect(calls).toEqual(["m", "a"]);
  expect(batch.results.map((result) => result.id)).toEqual(["a", "m"]);

  // A runtime definition without a callable or structural field is refused at register, not at run.
  const incomplete = createAnalyzerRegistry();
  const { validateParams: _dropped, ...withoutValidator } = probe({ id: "plugin.partial" });
  const partialFailure = registerAnalyzerIsolated(incomplete, withoutValidator as unknown as AnalyzerDefinition);
  expect(partialFailure).toContain("validateParams must be a function");
  expect(() =>
    incomplete.register({ ...probe({ id: "plugin.cost" }), cost: { freshRuns: -1, samples: 0 } }),
  ).toThrow("cost.freshRuns");
  // A group shares one fresh run, so a declared cost of two runs is refused rather than undercounted.
  expect(() =>
    incomplete.register({ ...probe({ id: "plugin.two", kind: "execution" }), cost: { freshRuns: 2, samples: 0 } }),
  ).toThrow("cost.freshRuns must be 0 or 1");
  expect(() =>
    incomplete.register({ ...probe({ id: "plugin.deps" }), dependencies: [{ id: "m" }] } as unknown as AnalyzerDefinition),
  ).toThrow("dependencies must be a list");
  expect(incomplete.list()).toEqual([]);

  // An implied dependency runs under the semantics of the analyzer that pulled it in.
  const implied = createAnalyzerRegistry();
  implied.register(probe({ id: "base" }));
  implied.register(probe({ id: "left", dependencies: [{ id: "base", version: "1" }] }));
  implied.register(probe({ id: "right", dependencies: [{ id: "base", version: "1" }] }));
  const session = analyzerSemantics({ sessionKey: "session-b", horizonSec: 100 });
  const inherited = implied.run({
    requests: [{ id: "left", version: "1", params: {}, semantics: session }],
    semantics: analyzerSemantics(),
  });
  expect(inherited.results.find((result) => result.id === "base")?.provenance.semantics).toEqual(session);
  const agreed = implied.run({
    requests: [
      { id: "left", version: "1", params: {}, semantics: session },
      { id: "right", version: "1", params: {}, semantics: session },
    ],
    semantics: analyzerSemantics(),
  });
  expect(agreed.results.map((result) => result.id)).toEqual(["base", "left", "right"]);
  expect(() =>
    implied.run({
      requests: [
        { id: "left", version: "1", params: {}, semantics: session },
        { id: "right", version: "1", params: {}, semantics: analyzerSemantics({ horizonSec: 5 }) },
      ],
      semantics: analyzerSemantics(),
    }),
  ).toThrow("dependency base@1 is implied with different semantics");

  // A dependent does not run when its dependency is blocked or does not finish ok.
  const dependents: string[] = [];
  const chained = createAnalyzerRegistry();
  chained.register(probe({ id: "gate", capabilities: ["flow"] }));
  chained.register(probe({ id: "after.gate", dependencies: [{ id: "gate", version: "1" }], onPostprocess: () => dependents.push("after.gate") }));
  chained.register({
    ...probe({ id: "short" }),
    postprocess: () => ({ status: "insufficient-data" as const, value: null }),
  });
  chained.register(probe({ id: "after.short", dependencies: [{ id: "short", version: "1" }], onPostprocess: () => dependents.push("after.short") }));
  const chainedBatch = chained.run({
    requests: [
      { id: "after.gate", version: "1", params: {} },
      { id: "after.short", version: "1", params: {} },
    ],
    semantics: analyzerSemantics(),
    capabilities: { flow: "unsupported" },
  });
  const byId = new Map(chainedBatch.results.map((result) => [result.id, result]));
  expect(byId.get("after.gate")?.status).toBe("unsupported");
  expect(byId.get("after.gate")?.issues).toEqual(["dependency gate@1 unsupported"]);
  expect(byId.get("after.short")?.status).toBe("insufficient-data");
  expect(byId.get("after.short")?.issues).toEqual(["dependency short@1 insufficient-data"]);
  expect(dependents).toEqual([]);
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-custom-analyzer The fixture metric and analyzer are registered by the caller. Builtins stay eta and growth.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-custom-analyzer #0eb3cb9 Re-read the section, then ran this function: fixture.ore returns 3 and is unsupported when the metric is absent, and growth for money is ok with only money registered.
 * @evidence ./analyzers.ts#analyzerCustomRegistration Reads the custom registration contract.
 * @evidenceReview ./analyzers.ts#analyzerCustomRegistration #e001f5c The declaration is caller-metric-and-analyzer.
 * @evidence ./analyzers.ts#createBuiltinAnalyzerRegistry Starts from the built-in growth and eta analyzers.
 * @evidenceReview ./analyzers.ts#createBuiltinAnalyzerRegistry #7f84bd3 The function creates a registry and registers the growth and eta definitions.
 */
export function runsCustomMetricAnalyzer(): void {
  expect(analyzerCustomRegistration).toBe("caller-metric-and-analyzer");
  const source = readFileSync(join(import.meta.dir, "analyzers.ts"), "utf8");
  expect(source).not.toContain("fixture.ore");
  expect(source).not.toContain("fixture.custom");
  const builtins = createBuiltinAnalyzerRegistry();
  expect(builtins.list()).toEqual([
    { id: "eta", version: "1" },
    { id: "growth", version: "1" },
  ]);
  expect("run" in createModelAnalysisRegistry()).toBe(false);

  const models = createModelAnalysisRegistry<number, "COIN", { ore: number }>();
  models.register({
    modelId: "fixture",
    modelVersion: 1,
    metrics: [
      {
        id: "fixture.ore",
        version: 1,
        meaning: "fixture ore",
        domain: "count",
        timeAxis: "instant",
        kind: "stock",
        extract: () => ({ available: true, domain: "count", value: 3 }),
      },
    ],
  });
  const metricIds = models.get("fixture", 1)?.metrics?.map((metric) => metric.id) ?? [];
  let calls = 0;
  const registry = createAnalyzerRegistry();
  registry.register(
    probe({
      id: "fixture.custom",
      metricIds: ["fixture.ore"],
      onPostprocess: () => {
        calls += 1;
        return 3;
      },
    }),
  );
  const ran = registry.run({
    requests: [{ id: "fixture.custom", version: "1", params: {} }],
    semantics: analyzerSemantics(),
    availableMetricIds: metricIds,
  });
  expect(ran.results[0]?.status).toBe("ok");
  expect(ran.results[0]?.value).toBe(3);
  const missing = registry.run({
    requests: [{ id: "fixture.custom", version: "1", params: {} }],
    semantics: analyzerSemantics(),
    availableMetricIds: [],
  });
  expect(missing.results[0]?.status).toBe("unsupported");
  expect(calls).toBe(1);
  expect(builtins.list().some((item) => item.id === "fixture.custom")).toBe(false);

  // A parameter-resolved demand names the metrics the request reads, not the static union.
  const scenario = makeScenario();
  const run = runScenario({
    ...scenario,
    run: { ...scenario.run, durationSec: 4, trace: { everySteps: 1, keepActionsLog: false } },
  });
  const growthRequest = (series: "money" | "netWorth") =>
    builtins.run({
      requests: [{ id: "growth", version: "1", params: { series, windowSec: 1 } }],
      semantics: analyzerSemantics(),
      supply: { schema: observationContract, windowSec: 1, sampleCadenceSec: 1, coverage: "trace", metricIds: [series] },
      input: { run, scenario },
      availableMetricIds: ["money"],
    }).results[0];
  expect(growthRequest("money")?.status).toBe("ok");
  expect(growthRequest("netWorth")?.status).toBe("unsupported");
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-insufficient-observation Summary coverage does not run analyzeGrowth. The result names a rerun.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-insufficient-observation #3499285 Re-read the section, then ran this function: value is null and the proxy input is not read.
 * @evidence ./analyzers.ts#analyzerInsufficientObservation Reads the insufficient-observation contract.
 * @evidenceReview ./analyzers.ts#analyzerInsufficientObservation #f1e3b70 The declaration is insufficient-observation-rerun-plan.
 * @evidence ./analyzers.ts#observationDemand Builds the demand that the supplied observation must meet.
 * @evidenceReview ./analyzers.ts#observationDemand #4fc7f7f The function returns a summary-coverage demand with no window, cadence, or metrics and the observation contract schema, plus overrides.
 * @evidence ./analyzers.ts#observationMeets Checks a supply against coverage, window, cadence, and metrics.
 * @evidenceReview ./analyzers.ts#observationMeets #2c058ec The function requires the same schema, at least the demanded coverage, a window and cadence no coarser than demanded, and every demanded metric.
 */
export function reportsInsufficientObservation(): void {
  const demand = observationDemand({ coverage: "trace", sampleCadenceSec: 5, metricIds: ["money"] });
  const supply = { schema: demand.observationSchema, coverage: "trace" as const, windowSec: null, sampleCadenceSec: 5, metricIds: ["money"] };
  expect(observationMeets(demand, supply)).toBe(true);
  expect(observationMeets(demand, { ...supply, sampleCadenceSec: 10 })).toBe(false);
  expect(observationMeets(demand, { ...supply, metricIds: [] })).toBe(false);
  expect(observationMeets(demand, null)).toBe(false);
  expect(analyzerInsufficientObservation).toBe("insufficient-observation-rerun-plan");
  const input = new Proxy({}, { get() { throw new Error("growth input was read"); } });
  const result = createBuiltinAnalyzerRegistry().run({
    requests: [{ id: "growth", version: "1", params: { series: "money", windowSec: 1 } }],
    semantics: analyzerSemantics(),
    supply: {
      schema: observationContract,
      windowSec: 1,
      sampleCadenceSec: 1,
      coverage: "summary",
      metricIds: ["money"],
    },
    input,
    allowExecution: false,
  }).results[0];
  expect(result?.status).toBe("insufficient-data");
  expect(result?.value).toBeNull();
  expect(result?.provenance.rerun?.reason).toBe("insufficient-data");
  expect(result?.provenance.demand.coverage).toBe("trace");
  expect(result?.provenance.freshRuns).toBe(0);
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-execution-budget A zero run budget and a horizon past the budget do not call execute. A granted run receives the factory.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-execution-budget #252cfcc Re-read the section, then ran this function: refused calls stay 0, one grant is not a second run, s2 is refused on samples, g2 runs after unsupported g1, eta reports missing-scenario, analytic eta is ok with no run budget, and a 100 second eta is refused under a 10 second budget.
 * @evidence ./analyzers.ts#analyzerExecutionBudget Reads the budget contract.
 * @evidenceReview ./analyzers.ts#analyzerExecutionBudget #9687833 The declaration is explicit-budget-not-silent-run.
 */
export function enforcesExecutionBudget(): void {
  expect(analyzerExecutionBudget).toBe("explicit-budget-not-silent-run");
  const factory = createRunFactory();
  let calls = 0;
  const registry = createAnalyzerRegistry();
  registry.register(
    probe({
      id: "fixture.exec",
      kind: "execution",
      observation: sharedDemand,
      onExecute: (ctx) => {
        calls += 1;
        expect(ctx.runFactory).toBe(factory);
        const first = ctx.requestRun("fixture.exec");
        const second = ctx.requestRun("fixture.exec");
        return { accepted: first.accepted, same: first === second };
      },
    }),
  );
  const semantics = analyzerSemantics({ horizonSec: 4, stepSec: 1 });
  const refused = registry.run({
    requests: [{ id: "fixture.exec", version: "1", params: {} }],
    semantics,
    allowExecution: true,
    budget: { maxFreshRuns: 0, maxDurationSec: 4, maxSamples: 10 },
    runFactory: factory,
  });
  expect(refused.results[0]?.status).toBe("insufficient-data");
  expect(refused.results[0]?.provenance.rerun?.reason).toBe("budget");
  expect(refused.freshRuns).toBe(0);
  const longHorizon = registry.run({
    requests: [{ id: "fixture.exec", version: "1", params: {} }],
    semantics: analyzerSemantics({ horizonSec: 100, stepSec: 1 }),
    allowExecution: true,
    budget,
    runFactory: factory,
  });
  expect(longHorizon.results[0]?.provenance.rerun?.note).toContain("explicit budget");
  expect(calls).toBe(0);
  const granted = registry.run({
    requests: [{ id: "fixture.exec", version: "1", params: {} }],
    semantics,
    allowExecution: true,
    budget: { maxFreshRuns: 1, maxDurationSec: 4, maxSamples: 10 },
    runFactory: factory,
  });
  expect(granted.freshRuns).toBe(1);
  expect(granted.results[0]?.value).toEqual({ accepted: true, same: true });
  expect(calls).toBe(1);
  const silent = registry.run({
    requests: [{ id: "fixture.exec", version: "1", params: {} }],
    semantics,
    allowExecution: false,
    runFactory: factory,
  });
  expect(silent.results[0]?.provenance.rerun?.reason).toBe("execution-not-requested");
  expect(calls).toBe(1);

  // Samples are reserved across the batch: two groups of 8 do not both fit a budget of 10.
  const execBudget = { maxFreshRuns: 2, maxDurationSec: 4, maxSamples: 10 };
  const sampled = createAnalyzerRegistry();
  sampled.register(probe({ id: "s1", kind: "execution", samples: 8, observation: observationDemand({ metricIds: ["a"] }) }));
  sampled.register(probe({ id: "s2", kind: "execution", samples: 8, observation: observationDemand({ metricIds: ["b"] }) }));
  const sampledBatch = sampled.run({
    requests: [
      { id: "s1", version: "1", params: {} },
      { id: "s2", version: "1", params: {} },
    ],
    semantics,
    allowExecution: true,
    budget: execBudget,
    runFactory: factory,
  });
  expect(sampledBatch.results.map((result) => result.status)).toEqual(["ok", "insufficient-data"]);
  expect(sampledBatch.results[1]?.provenance.rerun?.reason).toBe("budget");

  // A group that cannot run reserves nothing, so a later supported group keeps the one run.
  const gated = createAnalyzerRegistry();
  gated.register(probe({ id: "g1", kind: "execution", capabilities: ["flow"], observation: observationDemand({ metricIds: ["a"] }) }));
  gated.register(probe({ id: "g2", kind: "execution", observation: observationDemand({ metricIds: ["b"] }) }));
  const gatedBatch = gated.run({
    requests: [
      { id: "g1", version: "1", params: {} },
      { id: "g2", version: "1", params: {} },
    ],
    semantics,
    capabilities: { flow: "unsupported" },
    allowExecution: true,
    budget: { ...execBudget, maxFreshRuns: 1 },
    runFactory: factory,
  });
  expect(gatedBatch.results.map((result) => result.status)).toEqual(["unsupported", "ok"]);

  // A body's own reason survives: a missing scenario is not reported as a budget refusal.
  const noScenario = createBuiltinAnalyzerRegistry().run({
    requests: [
      { id: "eta", version: "1", params: { mode: "simulate", target: { kind: "money", value: "3" }, maxDurationSec: 4 } },
    ],
    semantics,
    allowExecution: true,
    budget: execBudget,
    runFactory: factory,
  });
  expect(noScenario.results[0]?.provenance.rerun?.reason).toBe("missing-scenario");
  expect(noScenario.freshRuns).toBe(0);

  // Analytic ETA does not simulate: it runs with no fresh-run budget and reports no fresh run.
  const etaArgs = { scenario: makeScenario(), target: { kind: "money" as const, value: "3" }, runFactory: factory };
  const analytic = runEtaAnalyzer({
    ...etaArgs,
    mode: "analytic",
    maxDurationSec: 4,
    budget: { maxFreshRuns: 0, maxDurationSec: 4, maxSamples: 0 },
  });
  expect(analytic.status).toBe("ok");
  expect(analytic.provenance.freshRuns).toBe(0);
  // Simulated ETA runs for maxDurationSec, so a shorter semantics horizon cannot slip it past the budget.
  const understated = runEtaAnalyzer({
    ...etaArgs,
    mode: "simulate",
    maxDurationSec: 100,
    semantics: analyzerSemantics({ horizonSec: 1 }),
    budget: { maxFreshRuns: 1, maxDurationSec: 10, maxSamples: 10 },
  });
  expect(understated.status).toBe("insufficient-data");
  expect(understated.provenance.rerun?.reason).toBe("budget");
  expect(understated.provenance.freshRuns).toBe(0);
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-same-algorithm The adapter value matches analyzeGrowth and etaSimulate, including algorithmVersion.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-same-algorithm #162ee6f Re-read the section, then ran this function: money 3 is 3 seconds and the growth segments match.
 * @evidence ./analyzers.ts#analyzerSameAlgorithm Reads the adapter contract.
 * @evidenceReview ./analyzers.ts#analyzerSameAlgorithm #e2dc432 The declaration is adapter-keeps-algorithm-version.
 * @evidence ./analyzers.ts#runGrowthAnalyzer Runs the growth analyzer on an executed run.
 * @evidenceReview ./analyzers.ts#runGrowthAnalyzer #d4aae6e The function runs the built-in growth analyzer as a postprocess request with the given series and window.
 * @evidence ./analyzers.ts#runEtaAnalyzer Runs the eta analyzer with an explicit budget.
 * @evidenceReview ./analyzers.ts#runEtaAnalyzer #8ef7e05 The function runs the built-in eta analyzer as an execution request with the target, mode, maximum duration, and budget.
 * @evidence ./analyzers.ts#growthAnalyzerAlgorithmVersion Reads the growth analyzer algorithm version.
 * @evidenceReview ./analyzers.ts#growthAnalyzerAlgorithmVersion #8646050 The function returns the growth analyzer algorithm version constant.
 */
export function matchesExistingAlgorithmVersions(): void {
  expect(analyzerSameAlgorithm).toBe("adapter-keeps-algorithm-version");
  const source = readFileSync(join(import.meta.dir, "analyzers.ts"), "utf8");
  expect(source).toContain("analyzeGrowth(");
  expect(source).toContain("etaSimulate(");
  expect(source).toContain("etaAnalytic(");
  expect(source).not.toContain("fitGrowth(");
  const scenario = makeScenario();
  const run = runScenario({
    ...scenario,
    run: { ...scenario.run, durationSec: 10, trace: { everySteps: 1, keepActionsLog: false } },
  });
  const directGrowth = analyzeGrowth({ run, scenario, series: "money", windowSec: 1 });
  const supply = {
    schema: observationContract,
    windowSec: 1,
    sampleCadenceSec: 1,
    coverage: "trace" as const,
    metricIds: ["money"],
  };
  const growth = runGrowthAnalyzer({ run, scenario, series: "money", windowSec: 1, supply });
  const growthAgain = createBuiltinAnalyzerRegistry().run({
    requests: [{ id: "growth", version: "1", params: { series: "money", windowSec: 1 } }],
    semantics: analyzerSemantics(),
    supply,
    input: { run, scenario },
  }).results[0];
  expect(growth.value).toEqual(directGrowth);
  expect(growth.algorithmVersion).toBe(growthAnalyzerAlgorithmVersion());
  expect(growthAgain?.algorithmVersion).toBe(growth.algorithmVersion);

  const factory = createRunFactory();
  const directEta = etaSimulate({ scenario, target: { kind: "money", value: "3" }, maxDurationSec: 10 });
  const eta = runEtaAnalyzer({
    scenario,
    target: { kind: "money", value: "3" },
    mode: "simulate",
    maxDurationSec: 10,
    budget: { maxFreshRuns: 1, maxDurationSec: 10, maxSamples: 10 },
    runFactory: factory,
  });
  expect(eta.provenance.freshRuns).toBe(1);
  expect((eta.value as { seconds: number; estimate: { algorithmVersion: string } }).seconds).toBe(directEta.seconds);
  expect(eta.algorithmVersion).toBe(directEta.estimate.algorithmVersion);
  expect(eta.algorithmVersion).toBe(etaEstimateAlgorithmVersion());
  const directAnalytic = etaAnalytic({ scenario, target: { kind: "money", value: "3" } });
  const analytic = runEtaAnalyzer({
    scenario,
    target: { kind: "money", value: "3" },
    mode: "analytic",
    maxDurationSec: 10,
    budget: { maxFreshRuns: 1, maxDurationSec: 10, maxSamples: 10 },
    runFactory: factory,
  });
  expect((analytic.value as { seconds: number }).seconds).toBe(directAnalytic.seconds);
  expect(analytic.algorithmVersion).toBe(directAnalytic.estimate.algorithmVersion);
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-observation-plan Shared semantics use one fresh run. A different horizon is a separate plan, and cadence is recorded.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-observation-plan #d7e6325 Re-read the section, then ran this function: everySteps is 2, the longer horizon is not in the shared group, cadence 1 at step 2 is refused, one and two get the same RunResult from one fresh run, delimiter and sharesRun false pairs take two runs, and a blocked peer is not in sharedWith.
 * @evidence ./analyzers.ts#analyzerObservationPlan Reads the plan contract.
 * @evidenceReview ./analyzers.ts#analyzerObservationPlan #e5b0d7f The declaration is demand-on-plan-and-provenance.
 * @evidence ./analyzers.ts#executionPlanForDemand Builds the execution plan a demand needs.
 * @evidenceReview ./analyzers.ts#executionPlanForDemand #cf5ae49 The function sets step, horizon, seed, and strategy from the semantics, and adds a trace only for window or trace coverage, at the demanded cadence rounded down to whole steps and at least one step.
 */
export function recordsObservationDemandOnThePlan(): void {
  const traced = executionPlanForDemand(
    analyzerSemantics({ horizonSec: 30, stepSec: 2, seed: 5 }),
    observationDemand({ coverage: "trace", sampleCadenceSec: 6 }),
  );
  expect(traced.trace).toEqual({ everySteps: 3, keepActionsLog: false });
  expect(traced.durationSec).toBe(30);
  expect(traced.seed).toBe(5);
  expect(executionPlanForDemand(analyzerSemantics(), observationDemand()).trace).toBeUndefined();
  expect(analyzerObservationPlan).toBe("demand-on-plan-and-provenance");
  const runs: string[] = [];
  const registry = createAnalyzerRegistry();
  const execute = (id: string) => () => {
    runs.push(id);
    return id;
  };
  registry.register(probe({
    id: "zeta",
    kind: "execution",
    observation: sharedDemand,
    onExecute: (ctx) => {
      execute("zeta")();
      return ctx.requestRun("zeta").plan.trace?.everySteps;
    },
  }));
  registry.register(probe({
    id: "alpha",
    kind: "execution",
    observation: sharedDemand,
    onExecute: (ctx) => {
      execute("alpha")();
      return ctx.requestRun("alpha").accepted;
    },
  }));
  registry.register(probe({
    id: "late",
    kind: "execution",
    observation: sharedDemand,
    onExecute: (ctx) => {
      execute("late")();
      return ctx.requestRun("late").accepted;
    },
  }));
  const semantics: RunSemantics = {
    sessionKey: "session-a",
    strategyKey: "greedy",
    horizonSec: 10,
    stepSec: 1,
    seed: 4,
  };
  const batch = registry.run({
    requests: [
      { id: "zeta", version: "1", params: {}, semantics },
      { id: "alpha", version: "1", params: {}, semantics },
      { id: "late", version: "1", params: {}, semantics: { ...semantics, horizonSec: 11 } },
    ],
    semantics,
    allowExecution: true,
    budget: { maxFreshRuns: 2, maxDurationSec: 11, maxSamples: 10 },
    runFactory: createRunFactory(),
  });
  expect(batch.freshRuns).toBe(2);
  expect(batch.results.map((result) => result.id)).toEqual(["alpha", "late", "zeta"]);
  const alpha = batch.results[0];
  const late = batch.results[1];
  const zeta = batch.results[2];
  expect(alpha?.provenance.sharedWith).toEqual(["zeta@1"]);
  expect(zeta?.provenance.sharedWith).toEqual(["alpha@1"]);
  expect(late?.provenance.sharedWith).toEqual([]);
  expect(alpha?.provenance.executionPlan?.trace?.everySteps).toBe(2);
  expect(alpha?.provenance.executionPlan?.durationSec).toBe(10);
  expect(alpha?.provenance.demand.sampleCadenceSec).toBe(2);
  expect(late?.provenance.semantics.horizonSec).toBe(11);
  expect(late?.provenance.executionPlan?.durationSec).toBe(11);
  expect(runs).toEqual(["alpha", "late", "zeta"]);

  // The traced cadence rounds down, so it is never coarser than the demand.
  const cadencePlan = (stepSec: number, sampleCadenceSec: number) =>
    executionPlanForDemand(analyzerSemantics({ stepSec }), observationDemand({ coverage: "trace", sampleCadenceSec }));
  expect(cadencePlan(2, 5).trace?.everySteps).toBe(2);
  expect(cadencePlan(0.1, 0.3).trace?.everySteps).toBe(3);
  // A demand finer than one step cannot be met. The body is not called.
  let fineCalls = 0;
  const fine = createAnalyzerRegistry();
  fine.register(probe({
    id: "fine",
    kind: "execution",
    observation: observationDemand({ coverage: "trace", sampleCadenceSec: 1 }),
    onExecute: () => {
      fineCalls += 1;
      return null;
    },
  }));
  const refusedFine = fine.run({
    requests: [{ id: "fine", version: "1", params: {} }],
    semantics: analyzerSemantics({ horizonSec: 4, stepSec: 2 }),
    allowExecution: true,
    budget,
    runFactory: createRunFactory(),
  });
  expect(refusedFine.results[0]?.status).toBe("insufficient-data");
  expect(refusedFine.results[0]?.provenance.rerun?.reason).toBe("insufficient-data");
  expect(refusedFine.freshRuns).toBe(0);
  expect(fineCalls).toBe(0);

  // Members of one group share the run itself, not only the grant: one fresh run is opened.
  let opened = 0;
  const base = createRunFactory();
  const counting: RunFactory = {
    bind: (scenario, options) => {
      const binding = base.bind(scenario, options);
      return {
        ...binding,
        fresh: (args) => {
          opened += 1;
          return binding.fresh(args);
        },
      };
    },
  };
  const shared = createAnalyzerRegistry();
  for (const id of ["one", "two"]) {
    shared.register(probe({ id, kind: "execution", observation: sharedDemand, onExecute: (ctx) => ctx.requestRun(id).run() }));
  }
  const sharedBatch = shared.run({
    requests: [
      { id: "one", version: "1", params: {} },
      { id: "two", version: "1", params: {} },
    ],
    semantics: analyzerSemantics({ horizonSec: 4, stepSec: 1 }),
    scenario: makeScenario(),
    allowExecution: true,
    budget,
    runFactory: counting,
  });
  const sharedRun = sharedBatch.results[0]?.value as RunResult<number, string, Record<string, unknown>> | null;
  expect(opened).toBe(1);
  expect(sharedBatch.freshRuns).toBe(1);
  expect(sharedRun?.end.t).toBe(4);
  expect(sharedRun?.trace?.map((state) => state.t)).toEqual([0, 2, 4]);
  expect(sharedBatch.results[1]?.value).toBe(sharedRun);

  const twoRuns = { maxFreshRuns: 2, maxDurationSec: 10, maxSamples: 10 };
  const pair = (registry: ReturnType<typeof createAnalyzerRegistry>, left: RunSemantics, right: RunSemantics) =>
    registry.run({
      requests: [
        { id: "one", version: "1", params: {}, semantics: left },
        { id: "two", version: "1", params: {}, semantics: right },
      ],
      semantics: left,
      allowExecution: true,
      budget: twoRuns,
      runFactory: createRunFactory(),
    });
  // A `|` inside a session or strategy key does not make two different semantics one group.
  const plain = createAnalyzerRegistry();
  plain.register(probe({ id: "one", kind: "execution", onExecute: (ctx) => ctx.requestRun("one").accepted }));
  plain.register(probe({ id: "two", kind: "execution", onExecute: (ctx) => ctx.requestRun("two").accepted }));
  const delimited = pair(
    plain,
    analyzerSemantics({ sessionKey: "a", strategyKey: "b|c" }),
    analyzerSemantics({ sessionKey: "a|b", strategyKey: "c" }),
  );
  expect(delimited.freshRuns).toBe(2);
  expect(delimited.results.map((result) => result.provenance.sharedWith)).toEqual([[], []]);
  // An analyzer that runs its own simulation (sharesRun false) is never grouped with a peer.
  const exclusive = createAnalyzerRegistry();
  exclusive.register({ ...probe({ id: "one", kind: "execution", onExecute: (ctx) => ctx.requestRun("one").accepted }), sharesRun: false });
  exclusive.register(probe({ id: "two", kind: "execution", onExecute: (ctx) => ctx.requestRun("two").accepted }));
  const alone = pair(exclusive, analyzerSemantics(), analyzerSemantics());
  expect(alone.freshRuns).toBe(2);
  expect(alone.results[0]?.provenance.sharedWith).toEqual([]);
  // A blocked peer in the same group is not reported in sharedWith.
  const blockedPeer = createAnalyzerRegistry();
  blockedPeer.register(probe({ id: "one", kind: "execution", capabilities: ["flow"] }));
  blockedPeer.register(probe({ id: "two", kind: "execution" }));
  const peerBatch = blockedPeer.run({
    requests: [
      { id: "one", version: "1", params: {} },
      { id: "two", version: "1", params: {} },
    ],
    semantics: analyzerSemantics(),
    capabilities: { flow: "unsupported" },
    allowExecution: true,
    budget: twoRuns,
    runFactory: createRunFactory(),
  });
  expect(peerBatch.results.map((result) => result.status)).toEqual(["unsupported", "ok"]);
  expect(peerBatch.results[1]?.provenance.sharedWith).toEqual([]);
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-plugin-isolation Permission is required before a plugin path is accepted. A rejected analyzer leaves builtins registered.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-plugin-isolation #cf67732 Re-read the section, then ran this function: the duplicate failure is a string and growth remains.
 * @evidence ./analyzers.ts#analyzerPluginIsolation Reads the plugin isolation contract.
 * @evidenceReview ./analyzers.ts#analyzerPluginIsolation #64adb66 The declaration is permission-before-load-and-isolate-failure.
 * @evidence ./analyzers.ts#assertAnalyzerPluginsPermitted Refuses plugin paths without allow-plugin.
 * @evidenceReview ./analyzers.ts#assertAnalyzerPluginsPermitted #4370304 The function throws when plugin paths are given and allow-plugin is false.
 * @evidence ./analyzers.ts#registerAnalyzerIsolated Keeps a bad plugin analyzer from failing the registry.
 * @evidenceReview ./analyzers.ts#registerAnalyzerIsolated #2160869 The function registers the definition and returns the error message instead of throwing.
 */
export function isolatesPluginAnalyzerFailure(): void {
  expect(analyzerPluginIsolation).toBe("permission-before-load-and-isolate-failure");
  let continued = false;
  expect(() => {
    assertAnalyzerPluginsPermitted(false, ["plugin.ts"]);
    continued = true;
  }).toThrow("Plugin loading is disabled");
  expect(continued).toBe(false);
  expect(() => assertAnalyzerPluginsPermitted(true, ["plugin.ts"])).not.toThrow();
  expect(() => assertAnalyzerPluginsPermitted(false, [])).not.toThrow();
  const registry = createBuiltinAnalyzerRegistry();
  const failure = registerAnalyzerIsolated(registry, probe({ id: "growth" }));
  expect(failure).toContain("duplicate analyzer growth@1");
  const custom = registerAnalyzerIsolated(registry, probe({ id: "plugin.custom" }));
  expect(custom).toBeNull();
  expect(registry.list()).toEqual([
    { id: "eta", version: "1" },
    { id: "growth", version: "1" },
    { id: "plugin.custom", version: "1" },
  ]);
}

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-local-output JSON and Markdown contain the algorithm version. The module has no CLI, Jev, network, or filesystem import, and a thrown fetch is unused.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-local-output #ab80c47 Re-read the section, then ran this function: the fence contains growth-report-v1 and builtin ids exclude jev.
 * @evidence ./analyzers.ts#analyzerLocalOutput Reads the local output contract.
 * @evidenceReview ./analyzers.ts#analyzerLocalOutput #55160b2 The declaration is json-markdown-local-not-judge.
 * @evidence ./analyzers.ts#analyzerNotJudge Reads the boundary between creating evidence and judging it.
 * @evidenceReview ./analyzers.ts#analyzerNotJudge #8d7e949 The declaration is analyzer-creates-evidence-judge-interprets.
 * @evidence ./analyzers.ts#analyzerModuleBoundaryIssues Flags CLI, judge, filesystem, and network imports.
 * @evidenceReview ./analyzers.ts#analyzerModuleBoundaryIssues #329d7a4 The function reports cli, jev, filesystem, and network issues from import and fetch patterns in the source.
 * @evidence ./analyzers.ts#analyzerResultMarkdown Renders the result as a fenced JSON block.
 * @evidenceReview ./analyzers.ts#analyzerResultMarkdown #ca1d088 The function wraps the pretty-printed result JSON in a json code fence.
 */
export function rendersLocalAnalyzerOutput(): void {
  expect(analyzerLocalOutput).toBe("json-markdown-local-not-judge");
  expect(analyzerNotJudge).toBe("analyzer-creates-evidence-judge-interprets");
  const source = readFileSync(join(import.meta.dir, "analyzers.ts"), "utf8");
  expect(analyzerModuleBoundaryIssues(source)).toEqual([]);
  const scenario = makeScenario();
  const run = runScenario({
    ...scenario,
    run: { ...scenario.run, durationSec: 4, trace: { everySteps: 1, keepActionsLog: false } },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network is disabled");
  }) as unknown as typeof fetch;
  try {
    const result = runGrowthAnalyzer({
      run,
      scenario,
      series: "money",
      windowSec: 1,
      supply: {
        schema: observationContract,
        windowSec: 1,
        sampleCadenceSec: 1,
        coverage: "trace",
        metricIds: ["money"],
      },
    });
    const json = JSON.parse(JSON.stringify(result)) as { algorithmVersion: string };
    expect(json.algorithmVersion).toBe("growth-report-v1");
    const markdown = analyzerResultMarkdown(result);
    expect(markdown.startsWith("```json\n")).toBe(true);
    expect(markdown).toContain("growth-report-v1");
    expect(createBuiltinAnalyzerRegistry().list().some((item) => item.id === "jev")).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("analyzer registry", () => {
  it("rejects registry conflicts before a run", rejectsRegistryConflictsBeforeRun);
  it("runs a custom metric analyzer", runsCustomMetricAnalyzer);
  it("reports insufficient observation", reportsInsufficientObservation);
  it("enforces the execution budget", enforcesExecutionBudget);
  it("matches existing algorithm versions", matchesExistingAlgorithmVersions);
  it("records observation demand on the plan", recordsObservationDemandOnThePlan);
  it("isolates a plugin analyzer failure", isolatesPluginAnalyzerFailure);
  it("renders local analyzer output", rendersLocalAnalyzerOutput);
});
