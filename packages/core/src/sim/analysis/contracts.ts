import { createHash } from "crypto";
import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";

/**
 * Analysis artifact v1.
 * This is not CLI `_meta` and it does not replace ScenarioV1.
 * DX-02 owns AnalyzerRegistry. This module does not run analyzers.
 */

const ANALYSIS_SCHEMA_ID = "https://idlekit.dev/schemas/analysis.artifact.v1.schema.json" as const;
const ANALYSIS_ALGORITHM_VERSION = "analysis-artifact-v1" as const;

export function analysisSchemaId(): typeof ANALYSIS_SCHEMA_ID {
  return ANALYSIS_SCHEMA_ID;
}

export function analysisAlgorithmVersion(): typeof ANALYSIS_ALGORITHM_VERSION {
  return ANALYSIS_ALGORITHM_VERSION;
}

/**
 * @evidence docs/requirements/active/analysis-contracts.md#req-pr08-shared-goal One predicate feeds the ETA, experiment, and check adapters.
 * @evidenceReview docs/requirements/active/analysis-contracts.md#req-pr08-shared-goal #89fb124 Re-read the section: the shared id is eta-experiment-check.
 */
export const sharedGoalEvaluation = "eta-experiment-check" as const;

/**
 * @evidence docs/requirements/active/analysis-contracts.md#req-pr08-custom-metric A model id is registered from the outside. Core does not name that model's resources.
 * @evidenceReview docs/requirements/active/analysis-contracts.md#req-pr08-custom-metric #9564912 Re-read the section: registration is a registry entry, not a Model method.
 */
export const customMetricRegistration = "model-analysis-registry" as const;

/**
 * @evidence docs/requirements/active/analysis-contracts.md#req-pr08-analysis-artifact The wire contract is analysis artifact v1. Missing numbers stay absent.
 * @evidenceReview docs/requirements/active/analysis-contracts.md#req-pr08-analysis-artifact #5f4c544 Re-read the section: the id is idlekit.analysis.artifact.v1 and status is separate from method.
 */
export const analysisArtifactContract = "idlekit.analysis.artifact.v1" as const;

export type AnalysisStatus =
  | "ok"
  | "censored"
  | "unsupported"
  | "insufficient-data"
  | "invalid"
  | "error"
  | "unknown";

export type AnalysisMethod =
  | "exact"
  | "analytic-local"
  | "fixed-step"
  | "monte-carlo"
  | "heuristic-fit";

export type MetricDomain = "amount" | "count" | "time" | "ratio";
export type MetricKind = "stock" | "cumulative";
export type MetricTimeAxis = "instant" | "interval";
export type AmountSign = "positive" | "negative" | "zero" | "nonfinite";
export type CapabilityKnowledge = "statically-known" | "unknown" | "unsupported";
export type AnalysisCapabilityName = "metrics" | "goals" | "reset" | "flow" | "advance";
export type ArtifactCoverage = "complete" | "partial" | "incomplete" | "disabled" | "unknown";

export type AmountWire = Readonly<{
  unit: string;
  decimal: string;
}>;

/**
 * Observed, estimated, and unavailable readings share one wire object.
 * `kind` separates them. An unavailable reading has no `amount` and no `value`.
 */
export type MetricReadingV1 = Readonly<{
  metricId: string;
  metricVersion: number;
  meaning: string;
  metricKind: MetricKind;
  timeAxis: MetricTimeAxis;
  domain: MetricDomain;
  reading: "observed" | "estimated" | "unavailable";
  status: AnalysisStatus;
  method?: AnalysisMethod;
  sign?: AmountSign;
  amount?: AmountWire;
  value?: number;
  reason?: string;
}>;

export type GoalResultV1 = Readonly<{
  goalId: string;
  goalVersion: number;
  status: AnalysisStatus;
  method?: AnalysisMethod;
  reached?: boolean;
  atSec?: number;
  assumptions: readonly string[];
}>;

export type AnalysisArtifactV1 = Readonly<{
  schemaVersion: 1;
  algorithmVersion: string;
  assumptions: readonly string[];
  warnings: readonly string[];
  observationCoverage: ArtifactCoverage;
  horizon?: Readonly<{
    sec: number;
    kind: "duration" | "until" | "budget" | "unknown";
  }>;
  sampleCount?: number;
  effectiveRunHash?: string;
  metrics: readonly MetricReadingV1[];
  goals: readonly GoalResultV1[];
  capabilities: Readonly<{
    metrics: CapabilityKnowledge;
    goals: CapabilityKnowledge;
    reset: CapabilityKnowledge;
    flow: CapabilityKnowledge;
    advance: CapabilityKnowledge;
  }>;
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let analysisArtifactValidator: ((input: unknown) => IValidation<AnalysisArtifactV1>) | undefined;

export const validateAnalysisArtifact = (input: unknown): IValidation<AnalysisArtifactV1> =>
  (analysisArtifactValidator ??= typia.createValidate<AnalysisArtifactV1>())(input);

export function parseAnalysisArtifact(input: string): IValidation<AnalysisArtifactV1> {
  return typia.json.validateParse<AnalysisArtifactV1>(input);
}

function buildAnalysisArtifactJsonSchema() {
  return typia.json.schema<AnalysisArtifactV1, "3.1">();
}

let analysisArtifactJsonSchemaUnit: ReturnType<typeof buildAnalysisArtifactJsonSchema> | undefined;

export function analysisArtifactJsonSchema(): ReturnType<typeof buildAnalysisArtifactJsonSchema> {
  analysisArtifactJsonSchemaUnit ??= buildAnalysisArtifactJsonSchema();
  return analysisArtifactJsonSchemaUnit;
}

export type ArtifactProvenance = Readonly<{
  schemaHash: string;
  algorithmVersion: string;
  assumptionHash: string;
  provenance: string;
}>;

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function analysisCanonicalJson(value: unknown): string {
  return renderCanonical(value, new Set());
}

function renderCanonical(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => renderCanonical(entry ?? null, seen)).join(",")}]`;
    }
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${renderCanonical(entry, seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function analysisSchemaHash(): string {
  return sha256Text(analysisCanonicalJson(analysisArtifactJsonSchema()));
}

export function artifactProvenance(artifact: Pick<AnalysisArtifactV1, "algorithmVersion" | "assumptions">, schemaHash: string): ArtifactProvenance {
  const assumptionHash = sha256Text(analysisCanonicalJson(artifact.assumptions));
  const provenance = sha256Text(
    analysisCanonicalJson({
      algorithmVersion: artifact.algorithmVersion,
      assumptionHash,
      schemaHash,
    }),
  );
  return {
    schemaHash,
    algorithmVersion: artifact.algorithmVersion,
    assumptionHash,
    provenance,
  };
}

export function classifyAmount<N>(engine: Engine<N>, amount: N, unit: string): Pick<MetricReadingV1, "status" | "sign" | "amount" | "reason"> {
  if (!engine.isFinite(amount)) {
    return {
      status: "invalid",
      sign: "nonfinite",
      reason: nonfiniteKind(engine.toString(amount)),
    };
  }
  const decimal = engine.toString(amount);
  const cmp = engine.cmp(amount, engine.zero());
  if (cmp < 0) return { status: "ok", sign: "negative", amount: { unit, decimal } };
  if (cmp === 0) return { status: "ok", sign: "zero", amount: { unit, decimal } };
  return { status: "ok", sign: "positive", amount: { unit, decimal } };
}

function nonfiniteKind(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("nan")) return "nan";
  if (text.startsWith("-")) return "negative-infinity";
  return "infinity";
}

export function classifyFinite(value: number): Pick<MetricReadingV1, "status" | "sign" | "value" | "reason"> {
  if (!Number.isFinite(value)) {
    return {
      status: "invalid",
      sign: "nonfinite",
      reason: nonfiniteKind(String(value)),
    };
  }
  if (value < 0) return { status: "ok", sign: "negative", value };
  if (value === 0) return { status: "ok", sign: "zero", value };
  return { status: "ok", sign: "positive", value };
}

export type AnalysisIssue = Readonly<{ path: string; message: string }>;

/**
 * Cross-field rules the generator does not claim.
 * Unavailable readings must not carry a numeric stand-in.
 */
export function validateAnalysisSemantics(artifact: AnalysisArtifactV1): readonly AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  artifact.metrics.forEach((reading, index) => {
    const path = `metrics.${index}`;
    const unavailable = reading.reading === "unavailable" || reading.status !== "ok";
    if (reading.status !== "ok" && reading.reading !== "unavailable") {
      issues.push({ path, message: "non-ok reading is not labeled unavailable" });
    }
    if (unavailable && (reading.amount !== undefined || reading.value !== undefined)) {
      issues.push({ path, message: "unavailable reading carries a value" });
    }
    if (reading.status === "ok" && reading.domain === "amount" && reading.amount === undefined) {
      issues.push({ path, message: "ok amount reading has no decimal" });
    }
    if (reading.status === "ok" && reading.domain !== "amount" && reading.value === undefined) {
      issues.push({ path, message: "ok numeric reading has no value" });
    }
    if (reading.value !== undefined && !Number.isFinite(reading.value)) {
      issues.push({ path, message: "numeric value is nonfinite" });
    }
  });
  artifact.goals.forEach((goal, index) => {
    if (goal.status !== "ok" && goal.reached !== undefined) {
      issues.push({ path: `goals.${index}`, message: "unreached status still carries reached" });
    }
    if (goal.status !== "ok" && goal.method !== undefined) {
      issues.push({ path: `goals.${index}`, message: "non-ok goal carries a method" });
    }
  });
  if (
    artifact.sampleCount !== undefined &&
    (!Number.isInteger(artifact.sampleCount) || artifact.sampleCount < 0)
  ) {
    issues.push({ path: "sampleCount", message: "sampleCount is not a nonnegative integer" });
  }
  return issues;
}

export function renderAnalysisMarkdown(artifact: AnalysisArtifactV1): string {
  const lines = [
    "# Analysis artifact v1",
    "",
    `Algorithm: ${artifact.algorithmVersion}`,
    `Coverage: ${artifact.observationCoverage}`,
    `Capabilities: metrics ${artifact.capabilities.metrics}, goals ${artifact.capabilities.goals}, reset ${artifact.capabilities.reset}, flow ${artifact.capabilities.flow}, advance ${artifact.capabilities.advance}`,
  ];
  if (artifact.effectiveRunHash !== undefined) lines.push(`Run: ${artifact.effectiveRunHash}`);
  if (artifact.sampleCount !== undefined) lines.push(`Samples: ${artifact.sampleCount}`);
  if (artifact.assumptions.length > 0) {
    lines.push("", "## Assumptions", ...artifact.assumptions.map((item) => `- ${item}`));
  }
  if (artifact.warnings.length > 0) {
    lines.push("", "## Warnings", ...artifact.warnings.map((item) => `- ${item}`));
  }
  lines.push("", "## Metrics");
  if (artifact.metrics.length === 0) lines.push("None.");
  for (const metric of artifact.metrics) {
    const wire = metric.amount
      ? `${metric.amount.decimal} ${metric.amount.unit}`
      : metric.value !== undefined
        ? String(metric.value)
        : "absent";
    lines.push(`- ${metric.metricId}@${metric.metricVersion} ${metric.reading} ${metric.status} ${wire}`);
  }
  lines.push("", "## Goals");
  if (artifact.goals.length === 0) lines.push("None.");
  for (const goal of artifact.goals) {
    const reached = goal.reached === undefined ? "absent" : String(goal.reached);
    lines.push(`- ${goal.goalId}@${goal.goalVersion} ${goal.status} reached ${reached}`);
  }
  return `${lines.join("\n")}\n`;
}

export function analysisArtifactJson(artifact: AnalysisArtifactV1): string {
  return `${analysisCanonicalJson(artifact)}\n`;
}

export function unavailableReading(args: {
  metricId: string;
  metricVersion: number;
  meaning: string;
  metricKind: MetricKind;
  timeAxis: MetricTimeAxis;
  domain: MetricDomain;
  status: Exclude<AnalysisStatus, "ok">;
  reason?: string;
}): MetricReadingV1 {
  return {
    metricId: args.metricId,
    metricVersion: args.metricVersion,
    meaning: args.meaning,
    metricKind: args.metricKind,
    timeAxis: args.timeAxis,
    domain: args.domain,
    reading: "unavailable",
    status: args.status,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
  };
}
