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
 * @evidenceReview ./inspect.ts#fixedDurationStepCount #aabb71b The function steps nextBoundary without until until it stops, and reports the step count, the last dt, and whether that tick was partial. Past one million ticks it returns a null count, and a horizon of exactly one million keeps its count because the cap is checked only when another tick is due.
 * @evidence ./inspect.ts#buildScenarioInspect Builds the report from a fixed-duration request.
 * @evidenceReview ./inspect.ts#buildScenarioInspect #48c8bae The function derives horizon kind, observation supply, stage plans, engine and plugin notes, the planner bound, and diagnostics without running the scenario. It treats an omitted event log as enabled, traces every step without a cadence, leaves session stages and capped counts unknown, reports each stage's fast mode, and names an unresolved model in plugin-skipped. A traced run's window is its cadence, and plugin-skipped names an unresolved strategy too. A custom engine's domain is unknown and still warns, and an ltv stage's count is unknown. A trace cadence that is not a positive integer supplies no cadence. It reads untilExpr literals itself: amount literals use the engine domain, while t, prestige.count, and the numericUntilPaths the caller names always warn, since they go through Number. Another path has a run-time parser and does not warn. Each stage reports the action log it keeps, and an uncapped kept log is unlimited. A stage reports the fast mode its input carries, including one inherited from the scenario where the override does not apply.
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
  // Past the counting cap the count is unknown, not the cap with a partial tick.
  expect(fixedDurationStepCount(1_000_001, 1)).toEqual({ steps: null, lastDt: null, partial: false });
  // A horizon of exactly the cap keeps its count.
  expect(fixedDurationStepCount(1_000_000, 1)).toEqual({ steps: 1_000_000, lastDt: 1, partial: false });
  expect(buildScenarioInspect(request({ clock: { stepSec: 1, durationSec: 1_000_001 } })).stages[0]?.stepCount).toBe(
    "unknown",
  );
  // An omitted eventLog is the runner's enabled, unbounded log.
  const defaults = buildScenarioInspect(request());
  expect(defaults.budgets.events).toEqual({ enabled: true, maxEvents: null, unlimited: true });
  expect(defaults.diagnostics.some((item) => item.code === "unlimited-trace")).toBe(true);
  const bounded = buildScenarioInspect(request({ eventLog: { maxEvents: 100 } }));
  expect(bounded.budgets.events).toEqual({ enabled: true, maxEvents: 100, unlimited: false });
  expect(bounded.diagnostics.some((item) => item.code === "unlimited-trace")).toBe(false);
  const off = buildScenarioInspect(request({ eventLog: { enabled: false } }));
  expect(off.budgets.events.enabled).toBe(false);
  // A trace without a cadence is traced every step, as compileScenario runs it.
  const traced = buildScenarioInspect(
    request({
      trace: { include: true },
      analyzers: [
        {
          id: "cadence",
          version: "1",
          kind: "postprocess",
          observation: observationDemand({ coverage: "trace", sampleCadenceSec: 1 }),
        },
      ],
    }),
  );
  expect(traced.budgets.trace.everySteps).toBe(1);
  expect(traced.analyzers[0]?.met).toBe(true);
  // A traced run supplies windows as fine as its cadence, whatever its total duration.
  const longTrace = buildScenarioInspect(
    request({
      clock: { stepSec: 1, durationSec: 100 },
      trace: { include: true },
      analyzers: [
        { id: "window", version: "1", kind: "postprocess", observation: observationDemand({ coverage: "trace", windowSec: 5 }) },
      ],
    }),
  );
  expect(longTrace.analyzers[0]?.met).toBe(true);
  // A cadence of 0 retains no periodic samples, so it supplies no cadence.
  const zeroCadence = buildScenarioInspect(
    request({
      trace: { include: true, everySteps: 0 },
      analyzers: [
        { id: "cadence", version: "1", kind: "postprocess", observation: observationDemand({ coverage: "trace", sampleCadenceSec: 1 }) },
      ],
    }),
  );
  expect(zeroCadence.analyzers[0]?.met).toBe(false);
  // A strategy that only a skipped plugin provides is named in plugin-skipped.
  const skippedStrategy = buildScenarioInspect(
    request({
      stages: [],
      plugins: { resolve: false, requested: true, loadedIds: [], unresolvedStrategy: "plugin.walk" },
    }),
  );
  const skippedNote = skippedStrategy.diagnostics.find((item) => item.code === "plugin-skipped");
  expect(skippedNote?.evidence.strategy).toBe("plugin.walk");
  expect(skippedStrategy.invalid).toBe(false);
  // A stage that keeps every action without a cap reports an unlimited action log, as ltv does.
  const ltvStage = buildScenarioInspect(
    request({
      eventLog: { enabled: false },
      stages: [
        {
          name: "ltv",
          applies: { strategy: true, step: true, fast: true, session: false },
          stepSec: { value: 1, source: "scenario" },
          strategySource: "scenario",
          actionsLog: { kept: true },
        },
        {
          name: "simulate",
          applies: { strategy: true, step: true, fast: true, session: false },
          stepSec: { value: 1, source: "scenario" },
          strategySource: "scenario",
          actionsLog: { kept: false },
        },
      ],
    }),
  );
  expect(ltvStage.stages[0]?.actionsLog).toEqual({ kept: true, maxActions: null, unlimited: true });
  expect(ltvStage.stages[1]?.actionsLog).toEqual({ kept: false, maxActions: null, unlimited: false });
  expect(defaults.stages[0]?.actionsLog).toBeNull();
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
 * @evidenceReview ./inspect.ts#decimalExceedsNumberDomain #0930a6d The function reads a scientific exponent or the integer digits and reports a magnitude of 15 or more. A sign and a leading-dot mantissa are read too. An alpha suffix adds 3 to the exponent per alphaInfiniteIndex step, as parseMoney scales it.
 */
export function warnsOnDecimalRange(): void {
  expect(inspectDecimalRange).toBe("decimal-range-is-advisory");
  expect(decimalExceedsNumberDomain("1e400")).toBe(true);
  expect(decimalExceedsNumberDomain("15")).toBe(false);
  // The money grammar's sign and leading-dot spellings are read too.
  expect(decimalExceedsNumberDomain("+1e400")).toBe(true);
  expect(decimalExceedsNumberDomain(".1e400")).toBe(true);
  expect(decimalExceedsNumberDomain("1.e400")).toBe(true);
  // An alpha suffix scales by 1e3 per index, as the money parser reads it: aa is 1e3 and zz is 1e2028.
  expect(decimalExceedsNumberDomain("1zz")).toBe(true);
  expect(decimalExceedsNumberDomain("1aa")).toBe(false);
  expect(decimalExceedsNumberDomain("1ae")).toBe(true);
  expect(decimalExceedsNumberDomain("1e10ab")).toBe(true);
  expect(decimalExceedsNumberDomain("3d")).toBe(false);
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
  // A custom engine declares no domain, so it is unknown and wide literals still warn.
  const customReport = buildScenarioInspect(
    request({ decimals: ["1e400"], engine: { effectiveId: "plugin.decimal", source: "custom", accepted: true } }),
  );
  expect(customReport.numericDomain.exact).toBe("unknown");
  expect(customReport.diagnostics.find((item) => item.code === "decimal-range")?.evidence.engineId).toBe("plugin.decimal");
  // An untilExpr amount literal goes through the engine, so breakInfinity keeps it exact.
  const breakInfinity = { effectiveId: "breakInfinity", source: "flag", accepted: true } as const;
  const amountUntil = buildScenarioInspect(
    request({ clock: { stepSec: 1, untilExpr: "money >= 9999999999999999" }, engine: breakInfinity }),
  );
  expect(amountUntil.diagnostics.some((item) => item.code === "decimal-range")).toBe(false);
  const amountUntilNumber = buildScenarioInspect(request({ clock: { stepSec: 1, untilExpr: "money >= 9999999999999999" } }));
  expect(amountUntilNumber.diagnostics.find((item) => item.code === "decimal-range")?.evidence.literal).toBe(
    "9999999999999999",
  );
  // t and prestige.count go through Number whatever the engine, so they still warn under breakInfinity.
  const timeUntil = buildScenarioInspect(
    request({ clock: { stepSec: 1, untilExpr: "money >= 1e400 || t >= 9999999999999999" }, engine: breakInfinity }),
  );
  const timeWarning = timeUntil.diagnostics.find((item) => item.code === "decimal-range");
  expect(timeWarning?.evidence.literal).toBe("9999999999999999");
  expect(timeWarning?.evidence.count).toBe(1);
  expect(timeWarning?.evidence.numberParsed).toBe(1);
  const countUntil = buildScenarioInspect(
    request({ clock: { stepSec: 1, untilExpr: "prestige.count >= 1e20" }, engine: breakInfinity }),
  );
  expect(countUntil.diagnostics.some((item) => item.code === "decimal-range")).toBe(true);
  // Another path picks its parser from the run-time value. A string var is compared as text, so it does not warn
  // unless the caller knows the value is a number.
  const dynamicUntil = { stepSec: 1, untilExpr: "vars.code == 9999999999999999" };
  expect(
    buildScenarioInspect(request({ clock: dynamicUntil, engine: breakInfinity })).diagnostics.some(
      (item) => item.code === "decimal-range",
    ),
  ).toBe(false);
  expect(
    buildScenarioInspect(request({ clock: dynamicUntil })).diagnostics.some((item) => item.code === "decimal-range"),
  ).toBe(false);
  const numericVar = buildScenarioInspect(
    request({ clock: dynamicUntil, engine: breakInfinity, numericUntilPaths: ["vars.code"] }),
  );
  expect(numericVar.diagnostics.find((item) => item.code === "decimal-range")?.evidence.numberParsed).toBe(1);
  const source =readFileSync(join(import.meta.dir, "inspect.ts"), "utf8");
  expect(source.includes("Number(")).toBe(false);
}

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-stage-override The command step applies to simulate. Experience keeps the scenario step and the session. A long planner bound is not a duration.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-stage-override #d77f1bd Re-read the section, then ran this function: simulate step is 2 and measuredDurationSec is null.
 * @evidence ./inspect.ts#inspectStageOverride Reads the stage-plan contract.
 * @evidenceReview ./inspect.ts#inspectStageOverride #3f1fcca The declaration is stage-plans-differ.
 * @evidence ../strategy/planner.ts#plannerExpansionBound Caps the planner request and reports the expansion bound.
 * @evidenceReview ../strategy/planner.ts#plannerExpansionBound #bb124b8 The function floors the request at 1, caps horizon, beam, and branching, counts a wait branch beside the capped actions up to the rollout budget, reports whether it clamped, and has no measured duration.
 */
export function explainsStageOverrides(): void {
  const bound = plannerExpansionBound({ horizonSteps: 100, beamWidth: 20, maxBranchingActions: 20 });
  expect(bound.capped).toEqual({ horizonSteps: 32, beamWidth: 8, maxBranchingActions: 8 });
  // Each node also rolls out a wait branch, and decide stops at the rollout budget.
  expect(bound.expansionUpperBound).toBe(256);
  expect(bound.rolloutBudget).toBe(256);
  expect(plannerExpansionBound({ horizonSteps: 1, maxBranchingActions: 1 }).expansionUpperBound).toBe(2);
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
  // A session stage runs its schedule, not the scenario duration, so its tick count is unknown.
  expect(experience?.stepCount).toBe("unknown");
  const ltvReport = buildScenarioInspect(
    request({
      stages: [
        {
          name: "ltv",
          applies: { strategy: true, step: true, fast: true, session: false },
          stepSec: { value: 1, source: "scenario" },
          strategySource: "scenario",
        },
      ],
    }),
  );
  expect(ltvReport.stages[0]?.stepCount).toBe("unknown");
  expect(simulate?.stepCount).toBe(5);
  // The stage reports the fast mode it runs. A stage given no fast mode reports none.
  expect(simulate?.fast).toBeNull();
  expect(experience?.fast).toBeNull();
  // A stage the fast flag does not apply to still runs the scenario's fast mode, so that mode is reported.
  const inherited = buildScenarioInspect(
    request({
      stages: [
        {
          name: "experience",
          applies: { strategy: true, step: false, fast: false, session: true },
          stepSec: { value: 1, source: "scenario" },
          strategySource: "scenario",
          fast: { enabled: true, source: "scenario" },
        },
      ],
    }),
  );
  expect(inherited.stages[0]?.fast).toEqual({ enabled: true, source: "scenario" });
  const fastReport = buildScenarioInspect(
    request({
      stages: [
        {
          name: "simulate",
          applies: { strategy: true, step: true, fast: true, session: false },
          stepSec: { value: 1, source: "scenario" },
          strategySource: "scenario",
          fast: { enabled: false, source: "command" },
        },
      ],
    }),
  );
  expect(fastReport.stages[0]?.fast).toEqual({ enabled: false, source: "command" });
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
