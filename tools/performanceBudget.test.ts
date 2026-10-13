import { describe, expect, it } from "bun:test";
import {
  budgetDenominator,
  budgetEmptyDuration,
  budgetGateFailure,
  budgetHashMismatch,
  budgetPhaseLabels,
  budgetSameConfig,
  budgetSchema,
  budgetUnknownMetric,
  benchConfigFromScenario,
  buildPerformanceArtifact,
  comparePerformanceBudgets,
  configHash,
  currentHost,
  median,
  percentile,
  readBaselineArtifacts,
  readCount,
  readSamples,
  readPerformanceArtifact,
  representativeConfig,
  sameBenchConfig,
  sameHost,
  scenarioHash,
  scenarioWorkload,
  selectBaseline,
  workloadStepCount,
  type ArtifactInput,
  type PerformanceArtifact,
} from "./performanceBudget";

const host = { bun: "1.4.2", cpu: "test-cpu", os: "darwin", arch: "arm64" } as const;

function input(overrides: Partial<ArtifactInput> = {}): ArtifactInput {
  return {
    corpus: "representative",
    scenario: "examples/bench/representative.json",
    config: representativeConfig(),
    host,
    iterations: 7,
    warmup: 2,
    workloadCount: 100,
    phases: { runtimeMs: [100, 200] },
    ...overrides,
  };
}

function built(overrides: Partial<ArtifactInput> = {}): PerformanceArtifact {
  return buildPerformanceArtifact(input(overrides));
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-bench-schema A built artifact round-trips the contract, version, host, and unsupported alloc/step.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-bench-schema #da75f4f Re-read the section, then ran this function: contract is idlekit.performance-budget and alloc/step is unsupported.
 * @evidence ./performanceBudget.ts#budgetSchema Reads the bench output schema contract.
 * @evidenceReview ./performanceBudget.ts#budgetSchema #59b4f49 The declaration is bench-output-schema.
 * @evidence ./performanceBudget.ts#buildPerformanceArtifact Builds the artifact from phases, config, host, and counters.
 * @evidenceReview ./performanceBudget.ts#buildPerformanceArtifact #f1c9513 The function hashes the config, keeps the scenario hash, labels phases, derives median, p95, and rates from runtime samples only, records a supplied peak RSS, and fixes alloc/step as unsupported and worker timings as absent.
 * @evidence ./performanceBudget.ts#readPerformanceArtifact Accepts a round-tripped artifact and rejects a forged alloc/step.
 * @evidenceReview ./performanceBudget.ts#readPerformanceArtifact #b7c89fc The function checks contract, version, corpus, config, hash type, host fields, scenario fields, iteration metadata, and each metric status, and returns null for an alloc/step other than unsupported.
 * @evidence ./performanceBudget.ts#currentHost Reports the running Bun, platform, and architecture.
 * @evidenceReview ./performanceBudget.ts#currentHost #45ed392 The function reads Bun.version, process.platform, and process.arch, and on darwin reads the CPU brand, otherwise unsupported.
 */
export function acceptsPerformanceBudgetSchema(): void {
  const running = currentHost();
  expect(running.bun).toBe(Bun.version);
  expect(running.os).toBe(process.platform);
  expect(running.arch).toBe(process.arch);
  expect(running.cpu.length).toBeGreaterThan(0);
  expect(budgetSchema).toBe("bench-output-schema");
  const artifact = built({
    phases: { installMs: 1, prepareColdMs: 2, prepareWarmMs: [3], checkMs: 4, buildMs: 5, runtimeMs: [100] },
  });
  expect(artifact.contract).toBe("idlekit.performance-budget");
  expect(artifact.schemaVersion).toBe(1);
  expect(artifact.host).toEqual(host);
  expect(artifact.iterations).toBe(7);
  expect(artifact.warmup).toBe(2);
  expect(artifact.corpus).toBe("representative");
  expect(artifact.metrics.allocPerStep).toEqual({ status: "unsupported" });
  expect(artifact.worker.startupMs).toEqual({ status: "absent" });
  expect(artifact.worker.serializationMs).toEqual({ status: "absent" });
  const parsed = readPerformanceArtifact(JSON.parse(JSON.stringify(artifact)));
  expect(parsed?.contract).toBe("idlekit.performance-budget");
  expect(parsed?.metrics.allocPerStep).toEqual({ status: "unsupported" });
  const forged = JSON.parse(JSON.stringify(artifact)) as { metrics: { allocPerStep: { status: string; value: number } } };
  forged.metrics.allocPerStep = { status: "measured", value: 0 };
  expect(readPerformanceArtifact(forged)).toBeNull();
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-workload-denominator 100 steps at runtime 100ms and 200ms ignore prepare of 5000ms and 900ms.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-workload-denominator #4eb5d17 Re-read the section, then ran this function: the rate uses 150ms.
 * @evidence ./performanceBudget.ts#budgetDenominator Reads the runtime denominator contract.
 * @evidenceReview ./performanceBudget.ts#budgetDenominator #1306650 The declaration is runtime-denominator.
 * @evidence ./performanceBudget.ts#median Takes the middle runtime sample, or the mean of the middle pair.
 * @evidenceReview ./performanceBudget.ts#median #0f23953 The function sorts a copy, returns null for no samples, the middle value for an odd count, and the mean of the middle pair for an even count.
 * @evidence ./performanceBudget.ts#workloadStepCount Counts duration steps with a shorter last tick.
 * @evidenceReview ./performanceBudget.ts#workloadStepCount #ea53e64 The function steps min(stepSec, remaining) until the duration is reached, returns null for a non-finite or non-positive step or a negative duration, and returns null instead of a truncated count past 100,000,000 steps.
 */
export function keepsRuntimeWorkloadDenominator(): void {
  expect(median([])).toBeNull();
  expect(median([3, 1, 2])).toBe(2);
  expect(median([200, 100])).toBe(150);
  expect(workloadStepCount(10, 3)).toBe(4);
  expect(workloadStepCount(10, 2)).toBe(5);
  expect(workloadStepCount(0, 1)).toBe(0);
  expect(workloadStepCount(10, 0)).toBeNull();
  expect(workloadStepCount(Number.NaN, 1)).toBeNull();
  expect(workloadStepCount(1_000_001, 1)).toBe(1_000_001);
  expect(workloadStepCount(1e12, 1)).toBeNull();
  expect(budgetDenominator).toBe("runtime-denominator");
  const artifact = built({
    workloadCount: 100,
    phases: { prepareColdMs: 5000, prepareWarmMs: [900], runtimeMs: [100, 200] },
  });
  expect(artifact.metrics.stepsPerSec).toEqual({ status: "measured", value: 100 / 0.15 });
  const prepareMixed = 100 / ((5000 + 900 + 150) / 1000);
  expect(artifact.metrics.stepsPerSec).not.toEqual({ status: "measured", value: prepareMixed });
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-empty-duration No runtime samples and a 0ms sample do not invent a steps/sec of 0 or Infinity.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-empty-duration #02d4927 Re-read the section, then ran this function: empty samples are absent and a 0ms median stays measured.
 * @evidence ./performanceBudget.ts#budgetEmptyDuration Reads the empty duration contract.
 * @evidenceReview ./performanceBudget.ts#budgetEmptyDuration #a97d4b7 The declaration is empty-duration-absent.
 */
export function keepsEmptyDurationAbsent(): void {
  expect(budgetEmptyDuration).toBe("empty-duration-absent");
  const empty = built({ phases: { runtimeMs: [] }, workloadCount: 100 });
  expect(empty.metrics.totalTimeMedianMs).toEqual({ status: "absent" });
  expect(empty.metrics.totalTimeP95Ms).toEqual({ status: "absent" });
  expect(empty.metrics.stepsPerSec).toEqual({ status: "absent" });
  expect(JSON.stringify(empty.metrics.stepsPerSec)).not.toContain("Infinity");
  const zero = built({ phases: { runtimeMs: [0] }, workloadCount: 100 });
  expect(zero.metrics.totalTimeMedianMs).toEqual({ status: "measured", value: 0 });
  expect(zero.metrics.stepsPerSec).toEqual({ status: "absent" });
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-unknown-metric Omitted counters stay absent and a supplied 0 stays measured.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-unknown-metric #4278c4c Re-read the section, then ran this function: missing nodes are absent and a zero draw count is measured.
 * @evidence ./performanceBudget.ts#budgetUnknownMetric Reads the unknown metric contract.
 * @evidenceReview ./performanceBudget.ts#budgetUnknownMetric #8f3c3f8 The declaration is unknown-is-not-zero.
 */
export function keepsUnknownMetricsUnmeasured(): void {
  expect(budgetUnknownMetric).toBe("unknown-is-not-zero");
  const missing = built({});
  expect(missing.metrics.plannerExpandedNodes).toEqual({ status: "absent" });
  expect(missing.metrics.plannerNodesPerSec).toEqual({ status: "absent" });
  expect(missing.metrics.drawsPerSec).toEqual({ status: "absent" });
  expect(missing.metrics.observationRetainedSamples).toEqual({ status: "absent" });
  expect(missing.metrics.allocPerStep).toEqual({ status: "unsupported" });
  const zeros = built({ plannerExpandedNodes: 0, draws: 0, retainedSamples: 0 });
  expect(zeros.metrics.plannerExpandedNodes).toEqual({ status: "measured", value: 0 });
  expect(zeros.metrics.drawsPerSec).toEqual({ status: "measured", value: 0 });
  expect(zeros.metrics.observationRetainedSamples).toEqual({ status: "measured", value: 0 });
  expect(zeros.metrics.allocPerStep).toEqual({ status: "unsupported" });
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-gate-failure 100ms to 180ms fails when relative 0.25 and absolute 50 are both set. Two repeats do not pass.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-gate-failure #9bd2c8d Re-read the section, then ran this function: the unfavorable pair fails and the writer is not called.
 * @evidence ./performanceBudget.ts#budgetGateFailure Reads the gate failure contract.
 * @evidenceReview ./performanceBudget.ts#budgetGateFailure #38dd0b8 The declaration is unfavorable-fails.
 * @evidence ./performanceBudget.ts#comparePerformanceBudgets Fails a slower median only past both the relative and absolute limits.
 * @evidenceReview ./performanceBudget.ts#comparePerformanceBudgets #153f927 The function rejects a recomputed hash mismatch, a different config, a different scenario hash or workload count, or a different Bun, OS, or arch, fails too few repeats or an unmeasured median, fails when both limits are exceeded, and never calls the baseline writer.
 */
export function failsUnfavorableBudget(): void {
  expect(budgetGateFailure).toBe("unfavorable-fails");
  const policy = { minIterations: 4, relativeSlowdown: 0.25, absoluteMedianMs: 50 };
  const baseline = built({ phases: { runtimeMs: [100] } });
  const current = built({ phases: { runtimeMs: [180] } });
  let writes = 0;
  const comparison = comparePerformanceBudgets(baseline, current, policy, () => {
    writes += 1;
  });
  expect(comparison).toEqual({ status: "fail", reason: "regression" });
  const short = comparePerformanceBudgets(
    built({ iterations: 2, phases: { runtimeMs: [100] } }),
    built({ iterations: 2, phases: { runtimeMs: [100] } }),
    policy,
    () => {
      writes += 1;
    },
  );
  expect(short).toEqual({ status: "fail", reason: "too-few-repeats" });
  expect(writes).toBe(0);
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-baseline-hash A replaced config hash is rejected and the writer is not called.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-baseline-hash #d4cb210 Re-read the section, then ran this function: the mismatched hash is rejected.
 * @evidence ./performanceBudget.ts#budgetHashMismatch Reads the baseline hash contract.
 * @evidenceReview ./performanceBudget.ts#budgetHashMismatch #c3d9a80 The declaration is baseline-hash-rejected.
 */
export function rejectsBaselineHashMismatch(): void {
  expect(budgetHashMismatch).toBe("baseline-hash-rejected");
  const baseline = built({ phases: { runtimeMs: [100] } });
  const current = built({ phases: { runtimeMs: [100] } });
  const broken = { ...baseline, configHash: "0".repeat(64) };
  let writes = 0;
  const comparison = comparePerformanceBudgets(broken, current, {
    minIterations: 4,
    relativeSlowdown: 0.25,
    absoluteMedianMs: 50,
  }, () => {
    writes += 1;
  });
  expect(comparison).toEqual({ status: "rejected", reason: "baseline-hash-mismatch" });
  expect(writes).toBe(0);
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-same-config 4ms to 9ms passes the absolute floor. Observer, engine, and trace mismatches are rejected.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #25793f8 Re-read the section, then ran this function: the small pair passes and the other configs are rejected.
 * @evidence ./performanceBudget.ts#budgetSameConfig Reads the same-config contract.
 * @evidenceReview ./performanceBudget.ts#budgetSameConfig #0d25c6b The declaration is same-config-only.
 * @evidence ./performanceBudget.ts#sameBenchConfig Treats configs with the same fields in another key order as the same.
 * @evidenceReview ./performanceBudget.ts#sameBenchConfig #da10445 The function compares canonical JSON with sorted keys.
 * @evidence ./performanceBudget.ts#configHash Hashes the canonical config, independent of key order.
 * @evidenceReview ./performanceBudget.ts#configHash #46c5a1e The function returns the sha256 hex digest of the canonical JSON with sorted keys.
 * @evidence ./performanceBudget.ts#representativeConfig Defaults to the number engine with trace, observer, worker, and planner off.
 * @evidenceReview ./performanceBudget.ts#representativeConfig #872d7ee The function returns the representative config and applies overrides on top.
 */
export function comparesOnlyTheSameConfig(): void {
  const base = representativeConfig();
  expect(base).toEqual({
    engineId: "number",
    seed: null,
    modelId: "linear",
    modelVersion: 1,
    stepSec: 1,
    trace: "off",
    observer: "off",
    worker: "none",
    planner: "off",
  });
  const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
  expect(sameBenchConfig(base, reordered)).toBe(true);
  expect(sameBenchConfig(base, representativeConfig({ stepSec: 2 }))).toBe(false);
  expect(configHash(base)).toMatch(/^[0-9a-f]{64}$/);
  expect(configHash(reordered)).toBe(configHash(base));
  expect(configHash(representativeConfig({ stepSec: 2 }))).not.toBe(configHash(base));
  expect(budgetSameConfig).toBe("same-config-only");
  const policy = { minIterations: 4, relativeSlowdown: 0.25, absoluteMedianMs: 50 };
  let writes = 0;
  const quiet = built({ phases: { runtimeMs: [4] } });
  const noisy = built({ phases: { runtimeMs: [9] } });
  expect(comparePerformanceBudgets(quiet, noisy, policy, () => {
    writes += 1;
  })).toEqual({ status: "pass", reason: "within-budget" });
  const observer = built({ config: representativeConfig({ observer: "on" }), phases: { runtimeMs: [4] } });
  const engine = built({ config: representativeConfig({ engineId: "breakInfinity" }), phases: { runtimeMs: [4] } });
  const trace = built({ config: representativeConfig({ trace: "unbounded" }), phases: { runtimeMs: [4] } });
  expect(comparePerformanceBudgets(quiet, observer, policy, () => {
    writes += 1;
  }).reason).toBe("config-mismatch");
  expect(comparePerformanceBudgets(quiet, engine, policy, () => {
    writes += 1;
  }).reason).toBe("config-mismatch");
  expect(comparePerformanceBudgets(quiet, trace, policy, () => {
    writes += 1;
  }).reason).toBe("config-mismatch");
  expect(writes).toBe(0);
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-phase-labels prepare-cold is cold, prepare-warm is warm, and the runtime median is 150ms.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-phase-labels #4e1a2c4 Re-read the section, then ran this function: cold and warm labels stay off the runtime median.
 * @evidence ./performanceBudget.ts#budgetPhaseLabels Reads the phase label contract.
 * @evidenceReview ./performanceBudget.ts#budgetPhaseLabels #3555de8 The declaration is cold-warm-labels.
 */
export function keepsColdAndWarmLabels(): void {
  expect(budgetPhaseLabels).toBe("cold-warm-labels");
  const artifact = built({
    phases: {
      installMs: 10,
      prepareColdMs: 5000,
      prepareWarmMs: [900, 800],
      checkMs: 4,
      buildMs: 6,
      runtimeMs: [100, 200],
    },
  });
  expect(artifact.phases.find((phase) => phase.phase === "prepare-cold")).toEqual({
    phase: "prepare-cold",
    label: "cold",
    durationMs: 5000,
  });
  expect(artifact.phases.filter((phase) => phase.phase === "prepare-warm").map((phase) => phase.label)).toEqual([
    "warm",
    "warm",
  ]);
  expect(artifact.phases.find((phase) => phase.phase === "install")?.label).toBe("other");
  expect(artifact.phases.find((phase) => phase.phase === "check")?.label).toBe("other");
  expect(artifact.phases.find((phase) => phase.phase === "build")?.label).toBe("other");
  expect(artifact.metrics.totalTimeMedianMs).toEqual({ status: "measured", value: 150 });
  expect(artifact.metrics.stepsPerSec).toEqual({ status: "measured", value: 100 / 0.15 });
}

const representativeScenario = {
  model: { id: "linear", version: 1, params: { incomePerSec: "1.2" } },
  clock: { stepSec: 1, durationSec: 30 },
  strategy: { id: "greedy" },
};
const longScenario = { ...representativeScenario, clock: { stepSec: 1, durationSec: 1800 } };

function scenarioArtifact(scenario: unknown, runtimeMs: readonly number[]): PerformanceArtifact {
  return built({
    config: benchConfigFromScenario(scenario, "number"),
    scenarioHash: scenarioHash(scenario),
    workloadCount: scenarioWorkload(scenario),
    phases: { runtimeMs },
  });
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-same-config A 30-step and a 1800-step scenario share a config and are still rejected.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #25793f8 Re-read the section, then ran this function: a different scenario hash or workload count is workload-mismatch.
 * @evidence ./performanceBudget.ts#scenarioHash Hashes the canonical scenario, independent of key order.
 * @evidenceReview ./performanceBudget.ts#scenarioHash #021fb0f The function returns the sha256 hex digest of the canonical scenario JSON.
 * @evidence ./performanceBudget.ts#scenarioWorkload Counts the scenario clock and leaves an until expression unknown.
 * @evidenceReview ./performanceBudget.ts#scenarioWorkload #6337812 The function returns workloadStepCount of the clock, or null without a numeric duration and step or with a nonblank untilExpr.
 * @evidence ./performanceBudget.ts#comparePerformanceBudgets Rejects a baseline from another workload before any timing check.
 * @evidenceReview ./performanceBudget.ts#comparePerformanceBudgets #153f927 The function rejects a scenario hash or workload count that differs after the config matches, then a host that differs.
 */
export function rejectsDifferentWorkload(): void {
  const policy = { minIterations: 4, relativeSlowdown: 0.25, absoluteMedianMs: 50 };
  const short = scenarioArtifact(representativeScenario, [10]);
  const long = scenarioArtifact(longScenario, [10]);
  expect(short.config).toEqual(long.config);
  expect(short.configHash).toBe(long.configHash);
  expect(short.workloadCount).toBe(30);
  expect(long.workloadCount).toBe(1800);
  expect(comparePerformanceBudgets(short, long, policy)).toEqual({ status: "rejected", reason: "workload-mismatch" });
  const reordered = Object.fromEntries(Object.entries(representativeScenario).reverse());
  expect(scenarioHash(reordered)).toBe(scenarioHash(representativeScenario));
  const sameHashOtherCount = { ...short, workloadCount: 31 };
  expect(comparePerformanceBudgets(short, sameHashOtherCount, policy)).toEqual({
    status: "rejected",
    reason: "workload-mismatch",
  });
  expect(comparePerformanceBudgets(short, scenarioArtifact(representativeScenario, [11]), policy)).toEqual({
    status: "pass",
    reason: "within-budget",
  });
  const until = { ...representativeScenario, clock: { stepSec: 1, durationSec: 30, untilExpr: "money >= 10" } };
  expect(scenarioWorkload(until)).toBeNull();
  const blank = { ...representativeScenario, clock: { stepSec: 1, durationSec: 30, untilExpr: "  " } };
  expect(scenarioWorkload(blank)).toBe(30);
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-same-config The trace mode follows outputs.report.traceEverySteps, and the engine is the run's.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #25793f8 Re-read the section, then ran this function: a sampled trace is bounded and an every-step trace is unbounded.
 * @evidence ./performanceBudget.ts#benchConfigFromScenario Reads engine, seed, model, step, trace cadence, observer, and planner from a scenario.
 * @evidenceReview ./performanceBudget.ts#benchConfigFromScenario #a1a0db9 The function reads outputs.report.traceEverySteps, as the scenario compiler does, treats a cadence of 1 or none as every step, and takes the engine from the caller instead of scenario.engine.
 */
export function readsTraceCadence(): void {
  const withTrace = (report: Record<string, unknown>) => ({ ...representativeScenario, outputs: { report } });
  expect(benchConfigFromScenario(representativeScenario, "number").trace).toBe("off");
  expect(benchConfigFromScenario(withTrace({ includeTrace: true, traceEverySteps: 10 }), "number").trace).toBe("bounded");
  expect(benchConfigFromScenario(withTrace({ includeTrace: true, traceEverySteps: 1 }), "number").trace).toBe("unbounded");
  expect(benchConfigFromScenario(withTrace({ includeTrace: true }), "number").trace).toBe("unbounded");
  expect(benchConfigFromScenario(withTrace({ includeTrace: true, everySteps: 10 }), "number").trace).toBe("unbounded");
  const labelled = { ...representativeScenario, engine: { name: "breakInfinity" } };
  expect(benchConfigFromScenario(labelled, "number").engineId).toBe("number");
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-baseline-hash A bench-sim --out file is a baseline, and each scenario takes its own entry.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-baseline-hash #d4cb210 Re-read the section, then ran this function: the run output round-trips and selects by scenario hash.
 * @evidence ./performanceBudget.ts#readBaselineArtifacts Accepts one artifact or the perScenario budgets of a bench-sim result.
 * @evidenceReview ./performanceBudget.ts#readBaselineArtifacts #6d7d2c8 The function returns the direct artifact, or every perScenario budget, and null when any entry is invalid.
 * @evidence ./performanceBudget.ts#selectBaseline Picks the baseline with the same scenario hash, or the only one.
 * @evidenceReview ./performanceBudget.ts#selectBaseline #737fee5 The function prefers the same non-null scenario hash on the same host, then the same scenario hash, then a single baseline, and returns null otherwise.
 */
export function readsBenchOutputAsBaseline(): void {
  const short = scenarioArtifact(representativeScenario, [10]);
  const long = scenarioArtifact(longScenario, [20]);
  const runOutput = JSON.parse(JSON.stringify({
    contract: "idlekit.performance-budget",
    schemaVersion: 1,
    perScenario: [{ scenario: "a", budget: short }, { scenario: "b", budget: long }],
  })) as unknown;
  const baselines = readBaselineArtifacts(runOutput);
  expect(baselines?.length).toBe(2);
  expect(selectBaseline(baselines ?? [], long)?.scenarioHash).toBe(long.scenarioHash);
  expect(selectBaseline(baselines ?? [], short)?.scenarioHash).toBe(short.scenarioHash);
  const other = scenarioArtifact({ ...representativeScenario, strategy: { id: "planner" } }, [10]);
  expect(selectBaseline(baselines ?? [], other)).toBeNull();
  expect(readBaselineArtifacts(JSON.parse(JSON.stringify(short)))).toHaveLength(1);
  expect(selectBaseline([short], other)).toBe(short);
  const broken = JSON.parse(JSON.stringify(runOutput)) as { perScenario: Array<{ budget: unknown }> };
  broken.perScenario[1] = { budget: { contract: "idlekit.performance-budget" } };
  expect(readBaselineArtifacts(broken)).toBeNull();
  expect(readBaselineArtifacts({ perScenario: [] })).toBeNull();
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-gate-failure A baseline without a valid repeat count cannot reach the repeat check.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-gate-failure #9bd2c8d Re-read the section, then ran this function: missing or invalid iterations, warmup, and workload are rejected.
 * @evidence ./performanceBudget.ts#readPerformanceArtifact Rejects missing or invalid iteration metadata.
 * @evidenceReview ./performanceBudget.ts#readPerformanceArtifact #b7c89fc The function requires integer iterations >= 1, integer warmup >= 0, a null or integer workload >= 0, a phases array, and string or null scenario fields.
 */
export function rejectsBaselineWithoutIterations(): void {
  const artifact = JSON.parse(JSON.stringify(built({ peakRssBytes: 1024 }))) as Record<string, unknown>;
  expect(readPerformanceArtifact(artifact)).not.toBeNull();
  expect(readPerformanceArtifact(artifact)?.metrics.peakRssBytes).toEqual({ status: "measured", value: 1024 });
  const without = (key: string) => {
    const copy = { ...artifact };
    delete copy[key];
    return copy;
  };
  expect(readPerformanceArtifact(without("iterations"))).toBeNull();
  expect(readPerformanceArtifact(without("warmup"))).toBeNull();
  expect(readPerformanceArtifact(without("workloadCount"))).toBeNull();
  expect(readPerformanceArtifact(without("scenarioHash"))).toBeNull();
  expect(readPerformanceArtifact({ ...artifact, iterations: 0 })).toBeNull();
  expect(readPerformanceArtifact({ ...artifact, iterations: 6.5 })).toBeNull();
  expect(readPerformanceArtifact({ ...artifact, iterations: "7" })).toBeNull();
  expect(readPerformanceArtifact({ ...artifact, warmup: -1 })).toBeNull();
  expect(readPerformanceArtifact({ ...artifact, workloadCount: 1.5 })).toBeNull();
  expect(readPerformanceArtifact({ ...artifact, workloadCount: null })).not.toBeNull();
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-bench-schema p95 is nearest-rank, so seven samples report the slowest one.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-bench-schema #da75f4f Re-read the section, then ran this function: one slow sample in seven is the p95.
 * @evidence ./performanceBudget.ts#percentile Takes the nearest-rank percentile.
 * @evidenceReview ./performanceBudget.ts#percentile #b76d423 The function sorts a copy and returns the sample at ceil(n * p) - 1, clamped, or null for no samples.
 */
export function takesNearestRankP95(): void {
  const samples = [100, 100, 100, 100, 100, 100, 1000];
  expect(percentile(samples, 0.95)).toBe(1000);
  expect(percentile([], 0.95)).toBeNull();
  expect(percentile([5], 0.95)).toBe(5);
  expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
  expect(built({ phases: { runtimeMs: samples } }).metrics.totalTimeP95Ms).toEqual({ status: "measured", value: 1000 });
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-bench-schema Caller-supplied samples and counters cannot be negative.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-bench-schema #da75f4f Re-read the section, then ran this function: negative, blank, and fractional counter input throws.
 * @evidence ./performanceBudget.ts#readSamples Parses duration samples and rejects a negative or non-finite one.
 * @evidenceReview ./performanceBudget.ts#readSamples #51c54d8 The function splits on commas and throws for a blank list, a blank item, a non-finite item, or a negative item.
 * @evidence ./performanceBudget.ts#readCount Parses a counter and rejects anything but an integer >= 0.
 * @evidenceReview ./performanceBudget.ts#readCount #cb7d7e6 The function throws for a missing, blank, fractional, non-finite, or negative value.
 */
export function rejectsNegativeSamples(): void {
  // Flags are bound first: a string literal as the first call argument reads as a test title to the inventory scanner.
  const [runtime, nodes, workload, draws] = ["--runtime-ms", "--nodes", "--workload", "--draws"] as const;
  expect(readSamples(runtime, "100, 200,0")).toEqual([100, 200, 0]);
  expect(() => readSamples(runtime, "-1")).toThrow();
  expect(() => readSamples(runtime, "100,,200")).toThrow();
  expect(() => readSamples(runtime, "abc")).toThrow();
  expect(() => readSamples(runtime, undefined)).toThrow();
  expect(readCount(nodes, "0")).toBe(0);
  expect(readCount(nodes, "32")).toBe(32);
  expect(() => readCount(nodes, "-5")).toThrow();
  expect(() => readCount(workload, "1.5")).toThrow();
  expect(() => readCount(draws, "")).toThrow();
  expect(() => readCount(draws, undefined)).toThrow();
}

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-same-config A baseline from another Bun, OS, or arch is not compared.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #25793f8 Re-read the section, then ran this function: a Linux baseline is host-mismatch on darwin, and a CPU brand change alone still compares.
 * @evidence ./performanceBudget.ts#sameHost Compares Bun, OS, and arch, not CPU brand.
 * @evidenceReview ./performanceBudget.ts#sameHost #1bda6e8 The function returns true only when bun, os, and arch are equal.
 */
export function rejectsBaselineFromAnotherHost(): void {
  const policy = { minIterations: 4, relativeSlowdown: 0.25, absoluteMedianMs: 50 };
  const darwin = scenarioArtifact(representativeScenario, [10]);
  const linux = { ...darwin, host: { bun: "1.4.2", cpu: "unsupported", os: "linux", arch: "x64" } };
  const otherCpu = { ...darwin, host: { ...darwin.host, cpu: "other-cpu" } };
  expect(sameHost(darwin.host, otherCpu.host)).toBe(true);
  expect(sameHost(darwin.host, linux.host)).toBe(false);
  expect(sameHost(darwin.host, { ...darwin.host, bun: "1.4.3" })).toBe(false);
  expect(comparePerformanceBudgets(linux, darwin, policy)).toEqual({ status: "rejected", reason: "host-mismatch" });
  expect(comparePerformanceBudgets(otherCpu, darwin, policy)).toEqual({ status: "pass", reason: "within-budget" });
  expect(selectBaseline([linux, otherCpu], darwin)).toBe(otherCpu);
  expect(selectBaseline([linux], darwin)).toBe(linux);
}

describe("performance budget", () => {
  it("accepts the performance budget schema", acceptsPerformanceBudgetSchema);
  it("uses workload count over runtime only", keepsRuntimeWorkloadDenominator);
  it("keeps an empty duration absent", keepsEmptyDurationAbsent);
  it("keeps unknown metrics unmeasured", keepsUnknownMetricsUnmeasured);
  it("fails an unfavorable budget", failsUnfavorableBudget);
  it("rejects a baseline hash mismatch", rejectsBaselineHashMismatch);
  it("compares only the same config", comparesOnlyTheSameConfig);
  it("keeps cold and warm labels", keepsColdAndWarmLabels);
  it("rejects a baseline from another workload", rejectsDifferentWorkload);
  it("reads the trace cadence field", readsTraceCadence);
  it("reads bench-sim output as a baseline", readsBenchOutputAsBaseline);
  it("rejects a baseline without iteration metadata", rejectsBaselineWithoutIterations);
  it("takes a nearest-rank p95", takesNearestRankP95);
  it("rejects negative samples and counters", rejectsNegativeSamples);
  it("rejects a baseline from another host", rejectsBaselineFromAnotherHost);
});
