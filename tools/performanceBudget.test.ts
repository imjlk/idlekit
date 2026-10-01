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
  buildPerformanceArtifact,
  comparePerformanceBudgets,
  readPerformanceArtifact,
  representativeConfig,
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-bench-schema #b85a868 Re-read the section, then ran this function: contract is idlekit.performance-budget and alloc/step is unsupported.
 * @evidence ./performanceBudget.ts#budgetSchema Reads the bench output schema contract.
 * @evidenceReview ./performanceBudget.ts#budgetSchema #59b4f49 The declaration is bench-output-schema.
 */
export function acceptsPerformanceBudgetSchema(): void {
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-workload-denominator #11a4355 Re-read the section, then ran this function: the rate uses 150ms.
 * @evidence ./performanceBudget.ts#budgetDenominator Reads the runtime denominator contract.
 * @evidenceReview ./performanceBudget.ts#budgetDenominator #1306650 The declaration is runtime-denominator.
 */
export function keepsRuntimeWorkloadDenominator(): void {
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-unknown-metric #f80c38b Re-read the section, then ran this function: missing nodes are absent and a zero draw count is measured.
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-gate-failure #c1a6c6b Re-read the section, then ran this function: the unfavorable pair fails and the writer is not called.
 * @evidence ./performanceBudget.ts#budgetGateFailure Reads the gate failure contract.
 * @evidenceReview ./performanceBudget.ts#budgetGateFailure #38dd0b8 The declaration is unfavorable-fails.
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-baseline-hash #654f6b5 Re-read the section, then ran this function: the mismatched hash is rejected.
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #2373b21 Re-read the section, then ran this function: the small pair passes and the other configs are rejected.
 * @evidence ./performanceBudget.ts#budgetSameConfig Reads the same-config contract.
 * @evidenceReview ./performanceBudget.ts#budgetSameConfig #0d25c6b The declaration is same-config-only.
 */
export function comparesOnlyTheSameConfig(): void {
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
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-phase-labels #9da1e03 Re-read the section, then ran this function: cold and warm labels stay off the runtime median.
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

describe("performance budget", () => {
  it("accepts the performance budget schema", acceptsPerformanceBudgetSchema);
  it("uses workload count over runtime only", keepsRuntimeWorkloadDenominator);
  it("keeps an empty duration absent", keepsEmptyDurationAbsent);
  it("keeps unknown metrics unmeasured", keepsUnknownMetricsUnmeasured);
  it("fails an unfavorable budget", failsUnfavorableBudget);
  it("rejects a baseline hash mismatch", rejectsBaselineHashMismatch);
  it("compares only the same config", comparesOnlyTheSameConfig);
  it("keeps cold and warm labels", keepsColdAndWarmLabels);
});
