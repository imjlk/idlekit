import type { AnalysisCapabilityName, CapabilityKnowledge } from "./contracts";
import type { ObservationDemand, ObservationSupply } from "./analyzers";
import { observationMeets } from "./analyzers";
import { observationContract } from "../observation";
import { nextBoundary } from "../timeBoundary";
import { plannerExpansionBound } from "../strategy/planner";
import type { OfflinePolicy } from "../../scenario/offlinePolicy";

/**
 * Inspect explains a resolved plan. It does not tick, import plugins, or call the network.
 * Doctor remains the environment check. A cost figure is a budget proposal, not wall time.
 */

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-partial-tick A fixed duration counts every tick, including a shorter last tick.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-partial-tick #12b41ae Re-read the section: 10 seconds at step 3 is 4 ticks and the last dt is 1.
 */
export const inspectPartialTick = "partial-tick-included" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-until-unknown An until-only clock has no step upper bound.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-until-unknown #3b187c6 Re-read the section: without durationSec the step count is unknown.
 */
export const inspectUntilUnknown = "until-only-unknown" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-decimal-range A number-engine literal past the exact range is a warning. The literal is not passed through Number.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-decimal-range #ce8dd3e Re-read the section: 1e400 warns on number and does not warn on breakInfinity.
 */
export const inspectDecimalRange = "decimal-range-is-advisory" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-stage-override Simulate and experience keep different step and session applies. Planner cost is a bound.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-stage-override #d77f1bd Re-read the section: the command step stays on simulate, and the planner figure is not a duration.
 */
export const inspectStageOverride = "stage-plans-differ" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-plugins-default Named plugins stay unloaded unless resolve is set.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-plugins-default #f0a188d Re-read the section: user code is not-run and the loaded id list is empty.
 */
export const inspectPluginsDefault = "plugins-stay-unloaded" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-plugin-metadata Resolve reports factory ids and that import may run user code. Source text stays out.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-plugin-metadata #211b9cf Re-read the section: the loaded id is reported and the source sentinel is absent.
 */
export const inspectPluginMetadata = "metadata-after-trust" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-capability-split Unsupported is a declared no. Unknown is the absence of a declaration.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-capability-split #761d04c Re-read the section: reset unsupported emits missing-reset, and flow unknown does not.
 */
export const inspectCapabilitySplit = "unsupported-is-not-unknown" as const;

/**
 * @evidence docs/requirements/active/scenario-inspect.md#req-dx03-no-run Inspect does not call the runner or the network. Analyzer demand is attached to the plan.
 * @evidenceReview docs/requirements/active/scenario-inspect.md#req-dx03-no-run #97d9296 Re-read the section: a trace demand is unmet when the scenario has no trace, and fetch is unused.
 */
export const inspectNoRun = "no-tick-no-network" as const;

export type InspectDiagnosticCode =
  | "bad-engine"
  | "missing-reset"
  | "insufficient-observation"
  | "unit-goal-mismatch"
  | "unlimited-trace"
  | "planner-cost"
  | "decimal-range"
  | "plugin-skipped"
  | "plugin-user-code"
  | "capability-unknown";

export type InspectDiagnostic = Readonly<{
  severity: "error" | "warning";
  code: InspectDiagnosticCode;
  evidence: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type InspectStageInput = Readonly<{
  name: "simulate" | "experience" | "ltv";
  applies: Readonly<{ strategy: boolean; step: boolean; fast: boolean; session: boolean }>;
  stepSec: Readonly<{ value: number; source: "scenario" | "command" | "stage" }>;
  strategyId?: string;
  strategySource: "scenario" | "command";
  session?: Readonly<{ id?: string; days?: number; source: "scenario" | "command" }>;
  /** The fast mode the stage runs: the command override, or the scenario setting it inherits. */
  fast?: Readonly<{ enabled: boolean; source: "scenario" | "command" }>;
}>;

export type InspectAnalyzerInput = Readonly<{
  id: string;
  version: string;
  kind: "postprocess" | "execution";
  observation: ObservationDemand;
}>;

export type ScenarioInspectRequest = Readonly<{
  model: Readonly<{ id: string; version: number }>;
  unitCode: string;
  walletUnit: string;
  clock: Readonly<{ stepSec: number; durationSec?: number; untilExpr?: string }>;
  offline?: OfflinePolicy;
  eventLog?: Readonly<{ enabled?: boolean; maxEvents?: number }>;
  trace: Readonly<{ include: boolean; everySteps?: number }>;
  engine: Readonly<{
    effectiveId: string;
    source: "default" | "flag" | "custom" | "rejected";
    scenarioEngine?: Readonly<{ name: string; version?: string }>;
    accepted: boolean;
    rejectReason?: string;
  }>;
  stages: readonly InspectStageInput[];
  capabilities: Readonly<Record<AnalysisCapabilityName, CapabilityKnowledge>>;
  analyzers: readonly InspectAnalyzerInput[];
  planner?: Readonly<{ horizonSteps: number; beamWidth?: number; maxBranchingActions?: number }> | null;
  decimals: readonly string[];
  prestigeRequested: boolean;
  plugins: Readonly<{
    resolve: boolean;
    requested: boolean;
    loadedIds: readonly string[];
    /** A scenario model no loaded registry holds, because its plugin was not resolved. */
    unresolvedModel?: string;
    /** A strategy no loaded registry holds, because its plugin was not resolved. The stages are not planned. */
    unresolvedStrategy?: string;
  }>;
}>;

export type ScenarioInspectReport = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.scenario-inspect.v1";
  simulated: false;
  doctor: false;
  invalid: boolean;
  engine: ScenarioInspectRequest["engine"] & Readonly<{ reason: string }>;
  model: ScenarioInspectRequest["model"];
  horizon: Readonly<{
    kind: "duration" | "until" | "unknown";
    durationSec: number | null;
    untilExpr: string | null;
  }>;
  stages: readonly Readonly<{
    name: InspectStageInput["name"];
    applies: InspectStageInput["applies"];
    stepSec: InspectStageInput["stepSec"];
    strategyId: string | null;
    strategySource: InspectStageInput["strategySource"];
    session: InspectStageInput["session"] | null;
    fast: NonNullable<InspectStageInput["fast"]> | null;
    stepCount: number | "unknown";
    lastDt: number | null;
    partialTick: boolean;
  }>[];
  offline: OfflinePolicy | null;
  budgets: Readonly<{
    events: Readonly<{ enabled: boolean; maxEvents: number | null; unlimited: boolean }>;
    trace: Readonly<{ include: boolean; everySteps: number | null; unlimited: boolean }>;
  }>;
  numericDomain: Readonly<{ engineId: string; exact: "safe-integer" | "decimal-string" }>;
  capabilities: ScenarioInspectRequest["capabilities"];
  analyzers: readonly Readonly<{
    id: string;
    version: string;
    kind: InspectAnalyzerInput["kind"];
    observation: ObservationDemand;
    met: boolean;
  }>[];
  planner: ReturnType<typeof plannerExpansionBound> | null;
  plugins: Readonly<{ userCode: "not-run" | "may-run"; loadedIds: readonly string[] }>;
  diagnostics: readonly InspectDiagnostic[];
}>;

const PLANNER_WARN_EXPANSIONS = 64;

/** Ticks of a fixed duration. Past the counting cap the count is null, not the cap. */
export function fixedDurationStepCount(
  durationSec: number,
  stepSec: number,
): Readonly<{ steps: number | null; lastDt: number | null; partial: boolean }> {
  let elapsed = 0;
  let steps = 0;
  let lastDt: number | null = null;
  const limit = 1_000_000;
  while (steps < limit) {
    const decision = nextBoundary({
      elapsedSec: elapsed,
      steps,
      stepSec,
      durationSec,
      untilMet: false,
      hasUntil: false,
    });
    if (decision.kind !== "step") {
      return { steps, lastDt, partial: lastDt !== null && lastDt + 1e-12 < stepSec };
    }
    lastDt = decision.dt;
    elapsed += decision.dt;
    steps += 1;
  }
  return { steps: null, lastDt: null, partial: false };
}

function exponentMagnitude(text: string): number {
  let sign = 1;
  let body = text;
  if (body.startsWith("+")) body = body.slice(1);
  else if (body.startsWith("-")) {
    sign = -1;
    body = body.slice(1);
  }
  let value = 0;
  for (const ch of body) value = value * 10 + (ch.charCodeAt(0) - 48);
  return sign * value;
}

export function decimalExceedsNumberDomain(literal: string): boolean {
  const trimmed = literal.trim();
  // The money parser accepts a sign and a leading-dot mantissa, such as +1e400 and .1e400.
  const scientific = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)[eE]([+-]?\d+)$/.exec(trimmed);
  if (scientific?.[1] !== undefined) return Math.abs(exponentMagnitude(scientific[1])) >= 15;
  const digits = trimmed.replace(/^[+-]/, "").split(".")[0] ?? "";
  return /^\d+$/.test(digits) && digits.length > 15;
}

function engineReason(engine: ScenarioInspectRequest["engine"]): string {
  if (!engine.accepted) return engine.rejectReason ?? "The engine was rejected before a run.";
  if (engine.source === "default") return "Number is the default. scenario.engine is metadata and is not applied.";
  if (engine.effectiveId === "breakInfinity") return "The engine flag selected breakInfinity. The literal is not passed through Number.";
  if (engine.source === "custom") return "A trusted factory already held by the caller created this engine.";
  return `The engine flag selected ${engine.effectiveId}.`;
}

function observationSupply(request: ScenarioInspectRequest, stepSec: number): ObservationSupply {
  const untilOnly = request.clock.durationSec === undefined && Boolean(request.clock.untilExpr?.trim());
  const coverage = request.trace.include ? "trace" : request.clock.durationSec !== undefined ? "summary" : "missing";
  // compileScenario traces every step when the scenario includes a trace without a cadence.
  const every = request.trace.everySteps ?? 1;
  return {
    schema: observationContract,
    // The finest window the samples supply is the trace cadence. A summary supplies no finite window.
    windowSec: request.trace.include ? every * stepSec : null,
    sampleCadenceSec: request.trace.include ? every * stepSec : null,
    coverage: untilOnly && !request.trace.include ? "missing" : coverage,
    metricIds: ["money", "netWorth"],
  };
}

export function buildScenarioInspect(request: ScenarioInspectRequest): ScenarioInspectReport {
  const diagnostics: InspectDiagnostic[] = [];
  const untilText = request.clock.untilExpr?.trim() ? request.clock.untilExpr.trim() : null;
  const horizonKind = request.clock.durationSec !== undefined ? "duration" : untilText ? "until" : "unknown";
  const supplyStep = request.stages.find((stage) => stage.name === "simulate")?.stepSec.value ?? request.clock.stepSec;
  const supply = observationSupply(request, supplyStep);

  if (!request.engine.accepted) {
    diagnostics.push({
      severity: "error",
      code: "bad-engine",
      evidence: {
        effectiveId: request.engine.effectiveId,
        reason: request.engine.rejectReason ?? null,
      },
    });
  }

  if (request.engine.accepted && request.engine.effectiveId === "number") {
    const wide = request.decimals.filter(decimalExceedsNumberDomain);
    if (wide.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "decimal-range",
        evidence: { engineId: "number", literal: wide[0] ?? null, count: wide.length },
      });
    }
  }

  if (request.walletUnit !== request.unitCode) {
    diagnostics.push({
      severity: "warning",
      code: "unit-goal-mismatch",
      evidence: { walletUnit: request.walletUnit, unitCode: request.unitCode },
    });
  }

  if (request.prestigeRequested && request.capabilities.reset === "unsupported") {
    diagnostics.push({
      severity: "warning",
      code: "missing-reset",
      evidence: { reset: "unsupported" },
    });
  }
  if (request.prestigeRequested && request.capabilities.reset === "unknown") {
    diagnostics.push({
      severity: "warning",
      code: "capability-unknown",
      evidence: { capability: "reset" },
    });
  }

  // The runner keeps the event log unless the scenario turns it off, so an omitted eventLog is enabled.
  const eventsEnabled = request.eventLog?.enabled !== false;
  const eventsUnlimited = eventsEnabled && request.eventLog?.maxEvents === undefined;
  const traceUnlimited = (request.trace.include && request.clock.durationSec === undefined) || eventsUnlimited;
  if (traceUnlimited) {
    diagnostics.push({
      severity: "warning",
      code: "unlimited-trace",
      evidence: {
        trace: request.trace.include,
        durationSec: request.clock.durationSec ?? null,
        eventMax: request.eventLog?.maxEvents ?? null,
      },
    });
  }

  const planner = request.planner ? plannerExpansionBound(request.planner) : null;
  if (planner && (planner.clamped || planner.expansionUpperBound > PLANNER_WARN_EXPANSIONS)) {
    diagnostics.push({
      severity: "warning",
      code: "planner-cost",
      evidence: {
        expansionUpperBound: planner.expansionUpperBound,
        measuredDurationSec: planner.measuredDurationSec,
        cappedHorizon: planner.capped.horizonSteps,
      },
    });
  }

  if (request.plugins.requested && !request.plugins.resolve) {
    diagnostics.push({
      severity: "warning",
      code: "plugin-skipped",
      evidence: {
        userCode: "not-run",
        model: request.plugins.unresolvedModel ?? null,
        strategy: request.plugins.unresolvedStrategy ?? null,
      },
    });
  }
  if (request.plugins.resolve) {
    diagnostics.push({
      severity: "warning",
      code: "plugin-user-code",
      evidence: { userCode: "may-run", loaded: request.plugins.loadedIds.length },
    });
  }

  const analyzers = request.analyzers.map((analyzer) => {
    const met = observationMeets(analyzer.observation, supply);
    if (!met) {
      diagnostics.push({
        severity: "warning",
        code: "insufficient-observation",
        evidence: {
          analyzer: `${analyzer.id}@${analyzer.version}`,
          demand: analyzer.observation.coverage,
          supply: supply.coverage,
        },
      });
    }
    return { ...analyzer, met };
  });

  const stages = request.stages.map((stage) => {
    const fast = stage.applies.fast ? stage.fast ?? null : null;
    // A session stage runs its schedule, not the scenario duration, so the duration does not count its ticks.
    if (request.clock.durationSec === undefined || stage.applies.session) {
      return {
        name: stage.name,
        applies: stage.applies,
        stepSec: stage.stepSec,
        strategyId: stage.strategyId ?? null,
        strategySource: stage.strategySource,
        session: stage.applies.session ? stage.session ?? null : null,
        fast,
        stepCount: "unknown" as const,
        lastDt: null,
        partialTick: false,
      };
    }
    const counted = fixedDurationStepCount(request.clock.durationSec, stage.stepSec.value);
    return {
      name: stage.name,
      applies: stage.applies,
      stepSec: stage.stepSec,
      strategyId: stage.strategyId ?? null,
      strategySource: stage.strategySource,
      session: stage.applies.session ? stage.session ?? null : null,
      fast,
      stepCount: counted.steps ?? ("unknown" as const),
      lastDt: counted.lastDt,
      partialTick: counted.partial,
    };
  });

  return {
    schemaVersion: 1,
    contract: "idlekit.scenario-inspect.v1",
    simulated: false,
    doctor: false,
    invalid: diagnostics.some((item) => item.severity === "error"),
    engine: { ...request.engine, reason: engineReason(request.engine) },
    model: request.model,
    horizon: {
      kind: horizonKind,
      durationSec: request.clock.durationSec ?? null,
      untilExpr: untilText,
    },
    stages,
    offline: request.offline ?? null,
    budgets: {
      events: {
        enabled: eventsEnabled,
        maxEvents: request.eventLog?.maxEvents ?? null,
        unlimited: eventsUnlimited,
      },
      trace: {
        include: request.trace.include,
        everySteps: request.trace.include ? request.trace.everySteps ?? 1 : request.trace.everySteps ?? null,
        unlimited: request.trace.include && request.clock.durationSec === undefined,
      },
    },
    numericDomain: {
      engineId: request.engine.effectiveId,
      exact: request.engine.effectiveId === "number" ? "safe-integer" : "decimal-string",
    },
    capabilities: request.capabilities,
    analyzers,
    planner,
    plugins: {
      userCode: request.plugins.resolve ? "may-run" : "not-run",
      loadedIds: request.plugins.resolve ? request.plugins.loadedIds : [],
    },
    diagnostics,
  };
}
