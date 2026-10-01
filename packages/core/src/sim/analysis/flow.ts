import typia, { type IValidation } from "typia";

/**
 * Passive flow diagnosis. This is not a factory runtime and not a second simulator loop.
 * Samples arrive from a fixture or from RunObserver.onFlow. A growth regime is not a cause.
 */

const FLOW_SCHEMA_ID = "https://idlekit.dev/schemas/flow.v1.schema.json" as const;
const FLOW_ALGORITHM_VERSION = "flow-observation-1" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The published schema id is the flow report.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section: the id is the flow v1 schema.
 */
export function flowSchemaId(): typeof FLOW_SCHEMA_ID {
  return FLOW_SCHEMA_ID;
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The algorithm version is flow-observation-1.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section: the version string is flow-observation-1.
 */
export function flowAlgorithmVersion(): typeof FLOW_ALGORITHM_VERSION {
  return FLOW_ALGORITHM_VERSION;
}

export type FlowSampleKind =
  | "inflow"
  | "throughput"
  | "capacity"
  | "queue"
  | "blocked-time"
  | "starved-time"
  | "unretained";

export type FlowSampleV1 = Readonly<{
  processId: string;
  resourceId: string;
  kind: FlowSampleKind;
  amount: string;
  unit: string;
  startSec: number;
  endSec: number;
}>;

export type FlowEdgeV1 = Readonly<{
  fromProcessId: string;
  toProcessId: string;
  fromResourceId: string;
  toResourceId: string;
  numerator: string;
  denominator: string;
  loss: string;
}>;

export type FlowCausalV1 = Readonly<{
  kind: "model" | "experiment";
  processId: string;
}>;

export type FlowLittlesV1 = Readonly<{
  inventory: string;
  arrivalPerSec: string;
  waitSec: string;
  steady: boolean;
  workFlowDefined: boolean;
}>;

export type FlowObservationV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.flow.observation.v1";
  capability: "statically-known" | "unsupported" | "unknown";
  steady: boolean;
  samples: readonly FlowSampleV1[];
  edges: readonly FlowEdgeV1[];
  causal: FlowCausalV1 | null;
  littles: FlowLittlesV1 | null;
}>;

export type FlowFactKind =
  | FlowSampleKind
  | "final-throughput"
  | "saturation-time"
  | "conservation";

export type FlowFactV1 = Readonly<{
  id: string;
  processId: string;
  kind: FlowFactKind;
  amount: string;
  unit: string;
  window: Readonly<{ startSec: number; endSec: number }>;
  evidenceRefs: readonly string[];
}>;

export type FlowCauseClaim = "capacity-constraint" | "material-shortage" | "demand-shortage" | "none";
export type FlowCauseStatus = "confirmed" | "suspected" | "insufficient-data" | "unsupported";

export type FlowHypothesisV1 = Readonly<{
  id: string;
  processId: string | null;
  status: FlowCauseStatus;
  claim: FlowCauseClaim;
  evidenceRefs: readonly string[];
  reason: string;
}>;

export type FlowReportV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.flow.v1";
  algorithmVersion: typeof FLOW_ALGORITHM_VERSION;
  capability: FlowObservationV1["capability"];
  status: "ok" | "unsupported" | "insufficient-data";
  facts: readonly FlowFactV1[];
  hypotheses: readonly FlowHypothesisV1[];
  littlesLaw: Readonly<{
    status: "not-applicable" | "consistent" | "inconsistent" | "insufficient-data";
    assumption: string;
  }>;
  stallMapped: false;
  externalProvider: false;
}>;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter Flow samples are optional. Model gains no required method.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section: the observer hook is optional and resource names stay in the fixture.
 */
export const flowOptionalAdapter = "observer-not-required-model" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-pipeline A steady 100 to 20 to 30 chain binds at the middle stage.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-pipeline #2bb5853 Re-read the section: final throughput stays 20 when inflow doubles.
 */
export const flowPipelineConstraint = "process-throughput-20" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-conservation Conversion, loss, and inventory stay in their own units.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-conservation #792fb51 Re-read the section: the source unit and the destination unit are not added.
 */
export const flowConservation = "converted-units-stay-apart" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-unsupported A model without flow observations is unsupported.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-unsupported #2733085 Re-read the section: a stall regime does not become a capacity cause.
 */
export const flowUnsupportedModel = "no-invented-stall" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-suspected Missing demand and capacity observations stay unresolved.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-suspected #17bae0a Re-read the section: facts and hypotheses are separate, and ramp-up skips Little's law.
 */
export const flowSuspectedCause = "facts-apart-from-cause" as const;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateFlowReportValidator: ((input: unknown) => IValidation<FlowReportV1>) | undefined;
let validateObservationValidator: ((input: unknown) => IValidation<FlowObservationV1>) | undefined;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The published validator is createValidate of the flow report.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section: the structural document is FlowReportV1.
 */
export const validateFlowReport = (input: unknown): IValidation<FlowReportV1> =>
  (validateFlowReportValidator ??= typia.createValidate<FlowReportV1>())(input);

function buildFlowJsonSchema() {
  return typia.json.schema<FlowReportV1, "3.1">();
}

let flowJsonSchemaUnit: ReturnType<typeof buildFlowJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section: schema version is 3.1 and the contract id is idlekit.flow.v1.
 */
export function flowJsonSchema(): ReturnType<typeof buildFlowJsonSchema> {
  flowJsonSchemaUnit ??= buildFlowJsonSchema();
  return flowJsonSchemaUnit;
}

const validateObservation = (input: unknown): IValidation<FlowObservationV1> =>
  (validateObservationValidator ??= typia.createValidate<FlowObservationV1>())(input);

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter A flow observation is validated as data.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section: the observation contract is idlekit.flow.observation.v1.
 */
export function parseFlowObservation(
  input: unknown,
): { ok: true; observation: FlowObservationV1 } | { ok: false; issues: readonly string[] } {
  const validated = validateObservation(input);
  if (validated.success) return { ok: true, observation: validated.data };
  return { ok: false, issues: validated.errors.map((error) => `${error.path} ${error.expected}`) };
}

function parseDecimal(text: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function formatDecimal(value: number): string {
  const rounded = Math.round(value * 1_000_000_000) / 1_000_000_000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function nearly(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= 1e-6 * scale;
}

function hypothesis(
  processId: string | null,
  status: FlowCauseStatus,
  claim: FlowCauseClaim,
  evidenceRefs: readonly string[],
  reason: string,
): FlowHypothesisV1 {
  return { id: `cause:${processId ?? "none"}`, processId, status, claim, evidenceRefs, reason };
}

function blank(capability: FlowObservationV1["capability"], status: FlowReportV1["status"], cause: FlowHypothesisV1, littlesStatus: FlowReportV1["littlesLaw"]["status"], assumption: string): FlowReportV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.flow.v1",
    algorithmVersion: FLOW_ALGORITHM_VERSION,
    capability,
    status,
    facts: [],
    hypotheses: [cause],
    littlesLaw: { status: littlesStatus, assumption },
    stallMapped: false,
    externalProvider: false,
  };
}

function littlesOf(littles: FlowLittlesV1 | null, capability: FlowObservationV1["capability"]): FlowReportV1["littlesLaw"] {
  if (capability !== "statically-known" || !littles) {
    return { status: "not-applicable", assumption: "Little's law needs a steady work-flow window" };
  }
  if (!littles.steady || !littles.workFlowDefined) {
    return { status: "not-applicable", assumption: "Little's law is not applied to a ramp-up or an undefined work flow" };
  }
  const inventory = parseDecimal(littles.inventory);
  const arrival = parseDecimal(littles.arrivalPerSec);
  const wait = parseDecimal(littles.waitSec);
  if (inventory === null || arrival === null || wait === null) {
    return { status: "insufficient-data", assumption: "Little's law inputs must be finite decimals" };
  }
  const expected = arrival * wait;
  return {
    status: nearly(inventory, expected) ? "consistent" : "inconsistent",
    assumption: "steady window and a defined work flow",
  };
}

type Rated = Readonly<{ sample: FlowSampleV1; index: number; value: number }>;

function rated(samples: readonly FlowSampleV1[]): Rated[] {
  const found: Rated[] = [];
  samples.forEach((sample, index) => {
    const value = parseDecimal(sample.amount);
    if (value !== null) found.push({ sample, index, value });
  });
  return found;
}

function firstRated(rows: readonly Rated[], processId: string, kind: FlowSampleKind): Rated | undefined {
  return rows.find((row) => row.sample.processId === processId && row.sample.kind === kind);
}

function convert(amount: number, edge: FlowEdgeV1): number | null {
  const numerator = parseDecimal(edge.numerator);
  const denominator = parseDecimal(edge.denominator);
  const loss = parseDecimal(edge.loss);
  if (numerator === null || denominator === null || loss === null || denominator === 0 || loss > 1) return null;
  return (amount * numerator) / denominator * (1 - loss);
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-pipeline Diagnosis reads throughput, capacity, and the evidence window.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-pipeline #2bb5853 Re-read the section: the middle stage binds and doubling inflow leaves throughput at 20.
 */
export function diagnoseFlow(observation: FlowObservationV1): FlowReportV1 {
  const littlesLaw = littlesOf(observation.littles, observation.capability);
  if (observation.capability === "unsupported") {
    return blank(
      observation.capability,
      "unsupported",
      hypothesis(null, "unsupported", "none", [], "flow capability is unsupported"),
      littlesLaw.status,
      littlesLaw.assumption,
    );
  }
  if (observation.capability === "unknown") {
    return blank(
      observation.capability,
      "insufficient-data",
      hypothesis(null, "insufficient-data", "none", [], "flow capability is unknown"),
      littlesLaw.status,
      littlesLaw.assumption,
    );
  }
  const rows = rated(observation.samples);
  const facts: FlowFactV1[] = rows.map((row) => ({
    id: `fact:${row.index}:${row.sample.kind}`,
    processId: row.sample.processId,
    kind: row.sample.kind,
    amount: row.sample.amount,
    unit: row.sample.unit,
    window: { startSec: row.sample.startSec, endSec: row.sample.endSec },
    evidenceRefs: [`sample:${row.index}`],
  }));
  const sinks = new Set<string>();
  const sources = new Set<string>();
  for (const edge of observation.edges) {
    sources.add(edge.fromProcessId);
    sinks.add(edge.toProcessId);
  }
  for (const source of sources) sinks.delete(source);
  const sinkId = [...sinks][0];
  const sinkThroughput = sinkId ? firstRated(rows, sinkId, "throughput") : rows.find((row) => row.sample.kind === "throughput");
  if (sinkThroughput) {
    facts.push({
      id: "fact:final-throughput",
      processId: sinkThroughput.sample.processId,
      kind: "final-throughput",
      amount: sinkThroughput.sample.amount,
      unit: sinkThroughput.sample.unit,
      window: { startSec: sinkThroughput.sample.startSec, endSec: sinkThroughput.sample.endSec },
      evidenceRefs: [`sample:${sinkThroughput.index}`],
    });
  }
  let binding: Rated | null = null;
  let bindingRefs: string[] = [];
  for (const row of rows) {
    if (row.sample.kind !== "throughput") continue;
    const capacity = firstRated(rows, row.sample.processId, "capacity");
    if (!capacity || capacity.sample.unit !== row.sample.unit || !nearly(row.value, capacity.value)) continue;
    const upstream = observation.edges.find((edge) => edge.toProcessId === row.sample.processId);
    const upstreamThroughput = upstream ? firstRated(rows, upstream.fromProcessId, "throughput") : undefined;
    const offered = upstream && upstreamThroughput ? convert(upstreamThroughput.value, upstream) : null;
    if (offered === null || !(offered > row.value && !nearly(offered, row.value))) continue;
    const downstream = observation.edges.find((edge) => edge.fromProcessId === row.sample.processId);
    const downstreamCapacity = downstream ? firstRated(rows, downstream.toProcessId, "capacity") : undefined;
    if (downstream && downstreamCapacity) {
      const forwarded = convert(row.value, downstream);
      if (forwarded === null || !(downstreamCapacity.value > forwarded && !nearly(downstreamCapacity.value, forwarded))) continue;
    }
    binding = row;
    bindingRefs = [`sample:${row.index}`, `sample:${capacity.index}`];
    if (upstreamThroughput) bindingRefs.push(`sample:${upstreamThroughput.index}`);
    facts.push({
      id: `fact:saturation:${row.sample.processId}`,
      processId: row.sample.processId,
      kind: "saturation-time",
      amount: formatDecimal(row.sample.endSec - row.sample.startSec),
      unit: "s",
      window: { startSec: row.sample.startSec, endSec: row.sample.endSec },
      evidenceRefs: [`sample:${row.index}`, `sample:${capacity.index}`],
    });
    break;
  }
  observation.edges.forEach((edge, edgeIndex) => {
    const inflow = firstRated(rows, edge.fromProcessId, "throughput") ?? firstRated(rows, edge.fromProcessId, "inflow");
    if (!inflow) return;
    const theoretical = convert(inflow.value, edge);
    if (theoretical === null) return;
    const queue = firstRated(rows, edge.toProcessId, "queue");
    const unretained = firstRated(rows, edge.toProcessId, "unretained");
    if (!queue || !unretained || queue.sample.unit !== unretained.sample.unit) return;
    if (queue.sample.unit === inflow.sample.unit) return;
    const held = queue.value + unretained.value;
    if (!nearly(held, theoretical)) return;
    facts.push({
      id: `fact:conservation:${edgeIndex}`,
      processId: edge.toProcessId,
      kind: "conservation",
      amount: formatDecimal(theoretical),
      unit: queue.sample.unit,
      window: { startSec: queue.sample.startSec, endSec: queue.sample.endSec },
      evidenceRefs: [`sample:${inflow.index}`, `sample:${queue.index}`, `sample:${unretained.index}`, `edge:${edgeIndex}`],
    });
  });
  const starved = rows.find((row) => row.sample.kind === "starved-time" && row.value > 0);
  const blocked = rows.find((row) => row.sample.kind === "blocked-time" && row.value > 0);
  let cause: FlowHypothesisV1;
  if (binding) {
    const confirmed = observation.causal?.processId === binding.sample.processId;
    cause = hypothesis(
      binding.sample.processId,
      confirmed ? "confirmed" : "suspected",
      "capacity-constraint",
      bindingRefs,
      confirmed ? "a causal model or experiment names this saturated process" : "the process is saturated, without a causal model or experiment",
    );
  } else if (starved && !blocked) {
    cause = hypothesis(starved.sample.processId, "suspected", "material-shortage", [`sample:${starved.index}`], "starved time was observed without a capacity bind");
  } else if (blocked && !starved) {
    cause = hypothesis(blocked.sample.processId, "suspected", "demand-shortage", [`sample:${blocked.index}`], "blocked time was observed without a capacity bind");
  } else {
    cause = hypothesis(null, "insufficient-data", "none", [], "demand and capacity were not both observed");
  }
  const conserved = facts.some((fact) => fact.kind === "conservation");
  const status: FlowReportV1["status"] =
    cause.status === "confirmed" || cause.status === "suspected" || conserved || sinkThroughput !== undefined
      ? "ok"
      : "insufficient-data";
  return {
    schemaVersion: 1,
    contract: "idlekit.flow.v1",
    algorithmVersion: FLOW_ALGORITHM_VERSION,
    capability: observation.capability,
    status: sinkThroughput && cause.status === "insufficient-data" && !conserved ? "insufficient-data" : status,
    facts,
    hypotheses: [cause],
    littlesLaw,
    stallMapped: false,
    externalProvider: false,
  };
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-unsupported A growth regime is not a flow sample.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-unsupported #2733085 Re-read the section: stall is not a capacity bottleneck.
 */
export function flowCauseForGrowthRegime(regime: string): FlowReportV1 {
  return blank(
    "unsupported",
    "unsupported",
    hypothesis(null, "unsupported", "none", [], `growth regime ${regime} is not a flow observation`),
    "not-applicable",
    "a growth regime is not a flow sample",
  );
}
