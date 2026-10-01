import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { AnalysisCapabilityName, CapabilityKnowledge } from "./contracts";
import { plannerExpansionBound } from "../strategy/planner";
import { observationDemand } from "./analyzers";
import {
  buildScenarioInspect,
  decimalExceedsNumberDomain,
  fixedDurationStepCount,
  inspectCapabilitySplit,
  inspectDecimalRange,
  inspectNoRun,
  inspectPartialTick,
  inspectPluginMetadata,
  inspectPluginsDefault,
  inspectStageOverride,
  inspectUntilUnknown,
  type ScenarioInspectRequest,
} from "./inspect";

function capabilities(
  overrides: Partial<Record<AnalysisCapabilityName, CapabilityKnowledge>> = {},
): ScenarioInspectRequest["capabilities"] {
  return {
    metrics: "statically-known",
    goals: "statically-known",
    reset: "statically-known",
    flow: "statically-known",
    advance: "statically-known",
    ...overrides,
  };
}

function request(overrides: Partial<ScenarioInspectRequest> = {}): ScenarioInspectRequest {
  return {
    model: { id: "linear", version: 1 },
    unitCode: "COIN",
    walletUnit: "COIN",
    clock: { stepSec: 1, durationSec: 10 },
    trace: { include: false, everySteps: 1 },
    engine: { effectiveId: "number", source: "default", accepted: true },
    stages: [
      {
        name: "simulate",
        applies: { strategy: true, step: true, fast: true, session: false },
        stepSec: { value: 1, source: "scenario" },
        strategySource: "scenario",
        strategyId: "greedy",
      },
    ],
    capabilities: capabilities(),
    analyzers: [],
    decimals: [],
    prestigeRequested: false,
    plugins: { resolve: false, requested: false, loadedIds: [] },
    ...overrides,
  };
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-partial-tick Duration 10 at step 3 counts 4 ticks and the last dt is 1.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-partial-tick #12b41ae Re-read the section, then ran this function: step 3 yields 4 and step 2 yields 5 full ticks.
 * @evidence ./inspect.ts#inspectPartialTick Reads the partial-tick contract.
 * @evidenceReview ./inspect.ts#inspectPartialTick #fbcbcf5 The declaration is partial-tick-included.
 * @evidence ./inspect.ts#fixedDurationStepCount Counts whole and partial ticks with nextBoundary.
 * @evidenceReview ./inspect.ts#fixedDurationStepCount #58c6750 The function steps nextBoundary without until until it stops, and reports the step count, the last dt, and whether that tick was partial.
 * @evidence ./inspect.ts#buildScenarioInspect Builds the report from a fixed-duration request.
 * @evidenceReview ./inspect.ts#buildScenarioInspect #387f33b The function derives horizon kind, observation supply, stage plans, engine and plugin notes, the planner bound, and diagnostics without running the scenario.
 */
export function countsFixedDurationSteps(): void {
  expect(inspectPartialTick).toBe("partial-tick-included");
  const partial = fixedDurationStepCount(10, 3);
  expect(partial.steps).toBe(4);
  expect(partial.lastDt).toBe(1);
  expect(partial.partial).toBe(true);
  const exact = fixedDurationStepCount(10, 2);
  expect(exact.steps).toBe(5);
  expect(exact.partial).toBe(false);
  const report = buildScenarioInspect(
    request({
      clock: { stepSec: 3, durationSec: 10 },
      stages: [
        {
          name: "simulate",
          applies: { strategy: true, step: true, fast: true, session: false },
          stepSec: { value: 3, source: "scenario" },
          strategySource: "scenario",
          strategyId: "greedy",
        },
      ],
    }),
  );
  expect(report.stages[0]?.stepCount).toBe(4);
  expect(report.stages[0]?.partialTick).toBe(true);
  expect(report.simulated).toBe(false);
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-until-unknown Until without durationSec leaves the step count unknown.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-until-unknown #3b187c6 Re-read the section, then ran this function: the horizon kind is until and the step count is unknown.
 * @evidence ./inspect.ts#inspectUntilUnknown Reads the until-only contract.
 * @evidenceReview ./inspect.ts#inspectUntilUnknown #c5dcb09 The declaration is until-only-unknown.
 */
export function marksUntilOnlyUnknown(): void {
  expect(inspectUntilUnknown).toBe("until-only-unknown");
  const report = buildScenarioInspect(
    request({ clock: { stepSec: 1, untilExpr: "money >= 3" } }),
  );
  expect(report.horizon.kind).toBe("until");
  expect(report.horizon.durationSec).toBeNull();
  expect(report.stages[0]?.stepCount).toBe("unknown");
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-decimal-range 1e400 warns for the number engine and stays a warning. breakInfinity does not warn.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-decimal-range #ce8dd3e Re-read the section, then ran this function: the report stays valid and the literal is the evidence.
 * @evidence ./inspect.ts#inspectDecimalRange Reads the decimal-range contract.
 * @evidenceReview ./inspect.ts#inspectDecimalRange #f9b5c90 The declaration is decimal-range-is-advisory.
 * @evidence ./inspect.ts#decimalExceedsNumberDomain Flags decimals with more than 15 integer digits or exponent magnitude.
 * @evidenceReview ./inspect.ts#decimalExceedsNumberDomain #75460f0 The function reads a scientific exponent or the integer digits and reports a magnitude of 15 or more.
 */
export function warnsOnDecimalRange(): void {
  expect(inspectDecimalRange).toBe("decimal-range-is-advisory");
  expect(decimalExceedsNumberDomain("1e400")).toBe(true);
  expect(decimalExceedsNumberDomain("15")).toBe(false);
  const numberReport = buildScenarioInspect(
    request({ decimals: ["1e400"], engine: { effectiveId: "number", source: "flag", accepted: true } }),
  );
  const numberWarning = numberReport.diagnostics.find((item) => item.code === "decimal-range");
  expect(numberWarning?.severity).toBe("warning");
  expect(numberWarning?.evidence.literal).toBe("1e400");
  expect(numberReport.invalid).toBe(false);
  const wideReport = buildScenarioInspect(
    request({
      decimals: ["1e400"],
      engine: { effectiveId: "breakInfinity", source: "flag", accepted: true },
    }),
  );
  expect(wideReport.diagnostics.some((item) => item.code === "decimal-range")).toBe(false);
  expect(wideReport.numericDomain.exact).toBe("decimal-string");
  const source = readFileSync(join(import.meta.dir, "inspect.ts"), "utf8");
  expect(source.includes("Number(")).toBe(false);
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-stage-override The command step applies to simulate. Experience keeps the scenario step and the session. A long planner bound is not a duration.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-stage-override #83026b4 Re-read the section, then ran this function: simulate step is 2 and measuredDurationSec is null.
 * @evidence ./inspect.ts#inspectStageOverride Reads the stage-plan contract.
 * @evidenceReview ./inspect.ts#inspectStageOverride #3f1fcca The declaration is stage-plans-differ.
 * @evidence ../strategy/planner.ts#plannerExpansionBound Caps the planner request and reports the expansion bound.
 * @evidenceReview ../strategy/planner.ts#plannerExpansionBound #2b867ed The function floors the request at 1, caps horizon, beam, and branching, reports the capped expansion count and whether it clamped, and has no measured duration.
 */
export function explainsStageOverrides(): void {
  const bound = plannerExpansionBound({ horizonSteps: 100, beamWidth: 20, maxBranchingActions: 20 });
  expect(bound.capped).toEqual({ horizonSteps: 32, beamWidth: 8, maxBranchingActions: 8 });
  expect(bound.expansionUpperBound).toBe(8 * (1 + 31 * 8));
  expect(bound.clamped).toBe(true);
  expect(bound.measuredDurationSec).toBeNull();
  expect(inspectStageOverride).toBe("stage-plans-differ");
  const report = buildScenarioInspect(
    request({
      clock: { stepSec: 1, durationSec: 10 },
      planner: { horizonSteps: 100, beamWidth: 8, maxBranchingActions: 8 },
      stages: [
        {
          name: "simulate",
          applies: { strategy: true, step: true, fast: true, session: false },
          stepSec: { value: 2, source: "command" },
          strategyId: "planner",
          strategySource: "command",
        },
        {
          name: "experience",
          applies: { strategy: true, step: false, fast: false, session: true },
          stepSec: { value: 1, source: "scenario" },
          strategyId: "planner",
          strategySource: "command",
          session: { id: "short-bursts", days: 3, source: "scenario" },
        },
      ],
    }),
  );
  const simulate = report.stages.find((stage) => stage.name === "simulate");
  const experience = report.stages.find((stage) => stage.name === "experience");
  expect(simulate?.stepSec).toEqual({ value: 2, source: "command" });
  expect(simulate?.session).toBeNull();
  expect(experience?.stepSec).toEqual({ value: 1, source: "scenario" });
  expect(experience?.applies.session).toBe(true);
  expect(experience?.session?.id).toBe("short-bursts");
  expect(report.planner?.measuredDurationSec).toBeNull();
  expect(report.planner?.clamped).toBe(true);
  const cost = report.diagnostics.find((item) => item.code === "planner-cost");
  expect(cost?.severity).toBe("warning");
  expect(cost?.evidence.measuredDurationSec).toBeNull();
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-plugins-default A named plugin is not loaded when resolve is false.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-plugins-default #f0a188d Re-read the section, then ran this function: user code is not-run and loaded ids are empty.
 * @evidence ./inspect.ts#inspectPluginsDefault Reads the default plugin contract.
 * @evidenceReview ./inspect.ts#inspectPluginsDefault #6988426 The declaration is plugins-stay-unloaded.
 */
export function leavesPluginsUnloaded(): void {
  expect(inspectPluginsDefault).toBe("plugins-stay-unloaded");
  const report = buildScenarioInspect(
    request({ plugins: { resolve: false, requested: true, loadedIds: ["should-not-stick"] } }),
  );
  expect(report.plugins.userCode).toBe("not-run");
  expect(report.plugins.loadedIds).toEqual([]);
  expect(report.diagnostics.some((item) => item.code === "plugin-skipped")).toBe(true);
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-plugin-metadata Resolve records the factory id and that import may run user code. The source sentinel is absent.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-plugin-metadata #211b9cf Re-read the section, then ran this function: loaded ids are noted and the sentinel is not in the JSON.
 * @evidence ./inspect.ts#inspectPluginMetadata Reads the plugin metadata contract.
 * @evidenceReview ./inspect.ts#inspectPluginMetadata #2a9bb8d The declaration is metadata-after-trust.
 */
export function reportsResolvedPluginMetadata(): void {
  expect(inspectPluginMetadata).toBe("metadata-after-trust");
  const report = buildScenarioInspect(
    request({ plugins: { resolve: true, requested: true, loadedIds: ["noted"] } }),
  );
  expect(report.plugins.userCode).toBe("may-run");
  expect(report.plugins.loadedIds).toEqual(["noted"]);
  expect(report.diagnostics.some((item) => item.code === "plugin-user-code")).toBe(true);
  expect(JSON.stringify(report).includes("PLUGIN_SOURCE_SENTINEL")).toBe(false);
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-capability-split Unsupported reset emits missing-reset. Unknown flow does not.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-capability-split #761d04c Re-read the section, then ran this function: reset is unsupported and flow stays unknown.
 * @evidence ./inspect.ts#inspectCapabilitySplit Reads the capability split.
 * @evidenceReview ./inspect.ts#inspectCapabilitySplit #9b107cb The declaration is unsupported-is-not-unknown.
 */
export function separatesUnsupportedFromUnknown(): void {
  expect(inspectCapabilitySplit).toBe("unsupported-is-not-unknown");
  const report = buildScenarioInspect(
    request({
      prestigeRequested: true,
      capabilities: capabilities({ reset: "unsupported", flow: "unknown" }),
    }),
  );
  expect(report.capabilities.reset).toBe("unsupported");
  expect(report.capabilities.flow).toBe("unknown");
  expect(report.diagnostics.some((item) => item.code === "missing-reset")).toBe(true);
  expect(report.diagnostics.some((item) => item.code === "capability-unknown" && item.evidence.capability === "flow")).toBe(
    false,
  );
  const unknownReset = buildScenarioInspect(
    request({ prestigeRequested: true, capabilities: capabilities({ reset: "unknown" }) }),
  );
  expect(unknownReset.diagnostics.some((item) => item.code === "missing-reset")).toBe(false);
  expect(unknownReset.diagnostics.some((item) => item.code === "capability-unknown")).toBe(true);
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-no-run A trace demand is unmet without calling a runner. A thrown fetch is unused.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-no-run #97d9296 Re-read the section, then ran this function: met is false and the source has no runner call.
 * @evidence ./inspect.ts#inspectNoRun Reads the no-run contract.
 * @evidenceReview ./inspect.ts#inspectNoRun #e077f91 The declaration is no-tick-no-network.
 */
export function doesNotSimulateOrFetch(): void {
  expect(inspectNoRun).toBe("no-tick-no-network");
  const source = readFileSync(join(import.meta.dir, "inspect.ts"), "utf8");
  expect(source.includes("runScenario")).toBe(false);
  expect(source.includes("stepOnce")).toBe(false);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network is disabled");
  }) as unknown as typeof fetch;
  try {
    const report = buildScenarioInspect(
      request({
        trace: { include: false },
        analyzers: [
          {
            id: "growth",
            version: "1",
            kind: "postprocess",
            observation: observationDemand({ coverage: "trace", metricIds: ["money"] }),
          },
        ],
      }),
    );
    expect(report.simulated).toBe(false);
    expect(report.analyzers[0]?.met).toBe(false);
    expect(report.diagnostics.some((item) => item.code === "insufficient-observation")).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("scenario inspect", () => {
  it("counts a fixed duration through the last partial tick", countsFixedDurationSteps);
  it("marks an until-only run unknown", marksUntilOnlyUnknown);
  it("warns when a decimal leaves the number domain", warnsOnDecimalRange);
  it("explains stage overrides and a planner bound", explainsStageOverrides);
  it("leaves named plugins unloaded", leavesPluginsUnloaded);
  it("reports resolved plugin metadata without source", reportsResolvedPluginMetadata);
  it("separates unsupported from unknown", separatesUnsupportedFromUnknown);
  it("does not simulate or fetch", doesNotSimulateOrFetch);
});
