import typia, { type IValidation } from "typia";

/**
 * Passive flow diagnosis. This is not a factory runtime and not a second simulator loop.
 * Samples arrive from a fixture or from RunObserver.onFlow. A growth regime is not a cause.
 */

const FLOW_SCHEMA_ID = "https://idlekit.dev/schemas/flow.v1.schema.json" as const;
const FLOW_ALGORITHM_VERSION = "flow-observation-1" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The published schema id is the flow report.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section: the id is the flow v1 schema.
 */
export function flowSchemaId(): typeof FLOW_SCHEMA_ID {
  return FLOW_SCHEMA_ID;
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The algorithm version is flow-observation-1.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section: the version string is flow-observation-1.
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
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section: the observer hook is optional and resource names stay in the fixture.
 */
export const flowOptionalAdapter = "observer-not-required-model" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-pipeline A steady 100 to 20 to 30 chain binds at the middle stage.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-pipeline #bed62f3 Re-read the section: final throughput stays 20 when inflow doubles, a bind reads one resource and one window, the causally named bind is confirmed among several, each terminal process reports a final throughput per delivered resource from its latest window, an inflow source offers work, a process binds on its latest saturated window, downstream slack counts every feed into that stage, a confirmed bind cites the causal record, and the bind cites its edges and requires a downstream capacity, upstream offer, and side feed in the unit an identity edge keeps, citing the throughput that named it.
 */
export const flowPipelineConstraint = "process-throughput-20" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-conservation Conversion, loss, and inventory stay in their own units.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-conservation #36612a7 Re-read the section: the source unit and the destination unit are not added, queue and unretained are read for the destination resource in the source window, every source window is tried with the latest conserving one kept, the stock must match an observed destination throughput unit and the fact cites it, edges into one stock are summed, and zero matches only zero.
 */
export const flowConservation = "converted-units-stay-apart" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-unsupported A model without flow observations is unsupported.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-unsupported #2733085 Re-read the section: a stall regime does not become a capacity cause.
 */
export const flowUnsupportedModel = "no-invented-stall" as const;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-suspected Missing demand and capacity observations stay unresolved.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-suspected #277b0a9 Re-read the section: facts and hypotheses are separate, starved and blocked time are judged per process from their latest window, where every resource in that window counts and a latest zero clears an older wait, with mixed waits unresolved, and a ramp-up observation or window skips Little's law.
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
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section: the structural document is FlowReportV1.
 */
export const validateFlowReport = (input: unknown): IValidation<FlowReportV1> =>
  (validateFlowReportValidator ??= typia.createValidate<FlowReportV1>())(input);

function buildFlowJsonSchema() {
  return typia.json.schema<FlowReportV1, "3.1">();
}

let flowJsonSchemaUnit: ReturnType<typeof buildFlowJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section: schema version is 3.1 and the contract id is idlekit.flow.v1.
 */
export function flowJsonSchema(): ReturnType<typeof buildFlowJsonSchema> {
  flowJsonSchemaUnit ??= buildFlowJsonSchema();
  return flowJsonSchemaUnit;
}

const validateObservation = (input: unknown): IValidation<FlowObservationV1> =>
  (validateObservationValidator ??= typia.createValidate<FlowObservationV1>())(input);

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter A flow observation is validated as data.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section: the observation contract is idlekit.flow.observation.v1, and an amount outside the finite non-negative decimal wire spelling, a duplicate sample key, a duplicate edge, a zero denominator, and a loss above 1 are rejected while parsing.
 */
export function parseFlowObservation(
  input: unknown,
): { ok: true; observation: FlowObservationV1 } | { ok: false; issues: readonly string[] } {
  const validated = validateObservation(input);
  if (!validated.success) {
    return { ok: false, issues: validated.errors.map((error) => `${error.path} ${error.expected}`) };
  }
  const issues = decimalIssues(validated.data);
  return issues.length === 0 ? { ok: true, observation: validated.data } : { ok: false, issues };
}

/** The decimal wire spelling engines print: optional sign, fraction, and exponent. */
const DECIMAL_WIRE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** A finite, non-negative amount in the decimal wire spelling. Anything else is null. */
function parseDecimal(text: string): number | null {
  if (!DECIMAL_WIRE.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return value === 0 ? 0 : value;
}

/** An amount the diagnosis could not read is rejected here, not dropped later. */
function decimalIssues(observation: FlowObservationV1): string[] {
  const issues: string[] = [];
  const check = (path: string, text: string): void => {
    if (parseDecimal(text) === null) issues.push(`${path} finite non-negative decimal`);
  };
  // One process, resource, kind, and window names one sample. A second one would make the reading order-dependent.
  const keys = new Map<string, number>();
  observation.samples.forEach((sample, index) => {
    check(`$input.samples[${index}].amount`, sample.amount);
    if (!(sample.endSec >= sample.startSec)) issues.push(`$input.samples[${index}].endSec >= startSec`);
    const key = JSON.stringify([sample.processId, sample.resourceId, sample.kind, sample.startSec, sample.endSec]);
    const first = keys.get(key);
    if (first !== undefined) issues.push(`$input.samples[${index}] duplicates samples[${first}]`);
    else keys.set(key, index);
  });
  // One source and destination pair names one edge. A copy would count the same flow twice.
  const edgeKeys = new Map<string, number>();
  observation.edges.forEach((edge, index) => {
    const key = JSON.stringify([edge.fromProcessId, edge.fromResourceId, edge.toProcessId, edge.toResourceId]);
    const first = edgeKeys.get(key);
    if (first !== undefined) issues.push(`$input.edges[${index}] duplicates edges[${first}]`);
    else edgeKeys.set(key, index);
    check(`$input.edges[${index}].numerator`, edge.numerator);
    check(`$input.edges[${index}].denominator`, edge.denominator);
    check(`$input.edges[${index}].loss`, edge.loss);
    if (parseDecimal(edge.denominator) === 0) issues.push(`$input.edges[${index}].denominator > 0`);
    const loss = parseDecimal(edge.loss);
    if (loss !== null && loss > 1) issues.push(`$input.edges[${index}].loss <= 1`);
  });
  if (observation.littles) {
    check("$input.littles.inventory", observation.littles.inventory);
    check("$input.littles.arrivalPerSec", observation.littles.arrivalPerSec);
    check("$input.littles.waitSec", observation.littles.waitSec);
  }
  return issues;
}

/**
 * Rounds to nine fraction digits. A value too large to scale has no fraction digits to round, and a nonzero
 * value that would round to zero keeps its own spelling.
 */
function formatDecimal(value: number): string {
  const scaled = value * 1_000_000_000;
  if (!Number.isFinite(scaled) || Math.abs(scaled) >= Number.MAX_SAFE_INTEGER) return String(value);
  const rounded = Math.round(scaled) / 1_000_000_000;
  return rounded === 0 && value !== 0 ? String(value) : String(rounded);
}

/**
 * Relative closeness. Zero is close only to zero, so a positive flow of any size is not equal to an empty stock.
 * A non-finite operand, such as an overflowed product, is never close.
 */
function nearly(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (left === 0 || right === 0) return left === right;
  const scale = Math.max(Math.abs(left), Math.abs(right));
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

function littlesOf(
  littles: FlowLittlesV1 | null,
  capability: FlowObservationV1["capability"],
  observationSteady: boolean,
): FlowReportV1["littlesLaw"] {
  if (capability !== "statically-known" || !littles) {
    return { status: "not-applicable", assumption: "Little's law needs a steady work-flow window" };
  }
  // A ramp-up marker on either the observation or the Little's law window keeps the law off.
  if (!observationSteady || !littles.steady || !littles.workFlowDefined) {
    return { status: "not-applicable", assumption: "Little's law is not applied to a ramp-up or an undefined work flow" };
  }
  const inventory = parseDecimal(littles.inventory);
  const arrival = parseDecimal(littles.arrivalPerSec);
  const wait = parseDecimal(littles.waitSec);
  if (inventory === null || arrival === null || wait === null) {
    return { status: "insufficient-data", assumption: "Little's law inputs must be finite decimals" };
  }
  const expected = arrival * wait;
  if (!Number.isFinite(expected)) {
    return { status: "insufficient-data", assumption: "Little's law inputs overflow a finite product" };
  }
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
    // A reversed window has no duration, so its sample is not evidence.
    if (value !== null && sample.endSec >= sample.startSec) found.push({ sample, index, value });
  });
  return found;
}

type Window = Readonly<{ startSec: number; endSec: number }>;

/** The sample of one process, resource, and kind inside exactly this evidence window. */
function sampleAt(
  rows: readonly Rated[],
  processId: string,
  resourceId: string,
  kind: FlowSampleKind,
  window: Window,
): Rated | undefined {
  return rows.find(
    (row) =>
      row.sample.processId === processId &&
      row.sample.resourceId === resourceId &&
      row.sample.kind === kind &&
      row.sample.startSec === window.startSec &&
      row.sample.endSec === window.endSec,
  );
}

/** The sample with the latest window: the greatest end, then the greatest start. Order in the input does not matter. */
function latest(candidates: readonly Rated[]): Rated | undefined {
  let best: Rated | undefined;
  for (const row of candidates) {
    if (
      !best ||
      row.sample.endSec > best.sample.endSec ||
      (row.sample.endSec === best.sample.endSec && row.sample.startSec > best.sample.startSec)
    ) {
      best = row;
    }
  }
  return best;
}

/** True when `candidate` is the defined bind over `held`: a later window, then a smaller resource id. */
function preferredBind(candidate: Rated, held: Rated): boolean {
  if (candidate.sample.endSec !== held.sample.endSec) return candidate.sample.endSec > held.sample.endSec;
  if (candidate.sample.startSec !== held.sample.startSec) return candidate.sample.startSec > held.sample.startSec;
  return candidate.sample.resourceId < held.sample.resourceId;
}

function convert(amount: number, edge: FlowEdgeV1): number | null {
  const numerator = parseDecimal(edge.numerator);
  const denominator = parseDecimal(edge.denominator);
  const loss = parseDecimal(edge.loss);
  if (numerator === null || denominator === null || loss === null || denominator === 0 || loss > 1) return null;
  const converted = (amount * numerator) / denominator * (1 - loss);
  return Number.isFinite(converted) ? converted : null;
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-pipeline Diagnosis reads throughput, capacity, and the evidence window.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-pipeline #bed62f3 Re-read the section: the middle stage binds and doubling inflow leaves throughput at 20; capacity and upstream samples match the edge resource and the throughput window, and every saturated process is a candidate.
 */
export function diagnoseFlow(observation: FlowObservationV1): FlowReportV1 {
  const littlesLaw = littlesOf(observation.littles, observation.capability, observation.steady);
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
  // Each terminal process reports the throughput of every resource its incoming edges deliver. A graph with
  // edges but no terminal process, such as a cycle, has no final throughput. Only an edgeless observation falls back.
  const finals: Rated[] = [];
  for (const sinkId of sinks) {
    const delivered = new Set(observation.edges.filter((edge) => edge.toProcessId === sinkId).map((edge) => edge.toResourceId));
    for (const resourceId of delivered) {
      const found = latest(
        rows.filter(
          (row) => row.sample.processId === sinkId && row.sample.resourceId === resourceId && row.sample.kind === "throughput",
        ),
      );
      if (found) finals.push(found);
    }
  }
  if (observation.edges.length === 0) {
    // Without edges no series is the terminal one, so every throughput series reports its latest window.
    const series = new Map<string, Rated[]>();
    for (const row of rows) {
      if (row.sample.kind !== "throughput") continue;
      const key = JSON.stringify([row.sample.processId, row.sample.resourceId]);
      series.set(key, [...(series.get(key) ?? []), row]);
    }
    for (const members of series.values()) {
      const chosen = latest(members);
      if (chosen) finals.push(chosen);
    }
  }
  for (const final of finals) {
    facts.push({
      // The pair is encoded structurally, so two different pairs never share an id and no string makes it throw.
      id: `fact:final-throughput:${JSON.stringify([final.sample.processId, final.sample.resourceId])}`,
      processId: final.sample.processId,
      kind: "final-throughput",
      amount: final.sample.amount,
      unit: final.sample.unit,
      window: { startSec: final.sample.startSec, endSec: final.sample.endSec },
      evidenceRefs: [`sample:${final.index}`],
    });
  }
  // Every saturated process is a candidate, so a later causally named bind is not missed. A process saturated
  // in several windows or resources keeps one defined bind: the latest window, then the first resource id.
  const byProcess = new Map<string, { row: Rated; capacity: Rated; refs: string[] }>();
  for (const row of rows) {
    if (row.sample.kind !== "throughput") continue;
    const { processId, resourceId } = row.sample;
    const window: Window = { startSec: row.sample.startSec, endSec: row.sample.endSec };
    const capacity = sampleAt(rows, processId, resourceId, "capacity", window);
    if (!capacity || capacity.sample.unit !== row.sample.unit || !nearly(row.value, capacity.value)) continue;
    // Every edge into this process and resource offers work, each read in the same window.
    const upstream = observation.edges.filter((edge) => edge.toProcessId === processId && edge.toResourceId === resourceId);
    const upstreamRefs: string[] = [];
    let offered: number | null = upstream.length > 0 ? 0 : null;
    for (const edge of upstream) {
      // A source may report its offer as throughput or, failing that, as inflow, as conservation reads it.
      const source =
        sampleAt(rows, edge.fromProcessId, edge.fromResourceId, "throughput", window) ??
        sampleAt(rows, edge.fromProcessId, edge.fromResourceId, "inflow", window);
      const converted = source ? convert(source.value, edge) : null;
      // An edge that keeps the resource keeps its rate unit, so its source must be in this process's unit.
      const unitMismatch = source !== undefined && edge.fromResourceId === edge.toResourceId && source.sample.unit !== row.sample.unit;
      if (!source || converted === null || offered === null || unitMismatch) {
        offered = null;
        break;
      }
      offered += converted;
      upstreamRefs.push(`sample:${source.index}`, `edge:${observation.edges.indexOf(edge)}`);
    }
    if (offered === null || !Number.isFinite(offered) || !(offered > row.value && !nearly(offered, row.value))) continue;
    // An observed downstream capacity must exceed everything that reaches it in this window: this process's
    // forwarded amount plus every other incoming edge. An unobserved other feed leaves the slack unproven.
    const downstream = observation.edges.filter((edge) => edge.fromProcessId === processId && edge.fromResourceId === resourceId);
    const downstreamRefs: string[] = [];
    const slack = downstream.every((edge) => {
      const downstreamCapacity = sampleAt(rows, edge.toProcessId, edge.toResourceId, "capacity", window);
      if (!downstreamCapacity) return true;
      // The capacity must be in the destination's rate unit: its own throughput unit, or this process's unit
      // when the edge keeps the resource. Without either, the comparison has no common unit.
      const destinationRate = sampleAt(rows, edge.toProcessId, edge.toResourceId, "throughput", window);
      const destinationUnit =
        destinationRate?.sample.unit ?? (edge.fromResourceId === edge.toResourceId ? row.sample.unit : undefined);
      if (downstreamCapacity.sample.unit !== destinationUnit) return false;
      let load = 0;
      const feedRefs: string[] = [];
      for (const [feedIndex, feed] of observation.edges.entries()) {
        if (feed.toProcessId !== edge.toProcessId || feed.toResourceId !== edge.toResourceId) continue;
        feedRefs.push(`edge:${feedIndex}`);
        if (feed === edge) {
          load += convert(row.value, feed) ?? Number.NaN;
          continue;
        }
        const other =
          sampleAt(rows, feed.fromProcessId, feed.fromResourceId, "throughput", window) ??
          sampleAt(rows, feed.fromProcessId, feed.fromResourceId, "inflow", window);
        if (!other) return false;
        // A feed that keeps the resource must already be in the destination unit to be added to the load.
        if (feed.fromResourceId === feed.toResourceId && other.sample.unit !== destinationUnit) return false;
        load += convert(other.value, feed) ?? Number.NaN;
        feedRefs.push(`sample:${other.index}`);
      }
      if (!Number.isFinite(load) || !(downstreamCapacity.value > load && !nearly(downstreamCapacity.value, load))) return false;
      // The throughput that named the destination unit is cited with the capacity it checked.
      downstreamRefs.push(
        `sample:${downstreamCapacity.index}`,
        ...(destinationRate ? [`sample:${destinationRate.index}`] : []),
        ...feedRefs,
      );
      return true;
    });
    if (!slack) continue;
    const held = byProcess.get(processId);
    if (!held || preferredBind(row, held.row)) {
      byProcess.set(processId, {
        row,
        capacity,
        refs: [`sample:${row.index}`, `sample:${capacity.index}`, ...upstreamRefs, ...downstreamRefs],
      });
    }
  }
  const bindings = [...byProcess.values()];
  for (const { row, capacity } of bindings) {
    facts.push({
      id: `fact:saturation:${row.sample.processId}`,
      processId: row.sample.processId,
      kind: "saturation-time",
      amount: formatDecimal(row.sample.endSec - row.sample.startSec),
      unit: "s",
      window: { startSec: row.sample.startSec, endSec: row.sample.endSec },
      evidenceRefs: [`sample:${row.index}`, `sample:${capacity.index}`],
    });
  }
  // Edges that deliver one destination process and resource are checked together, so fan-in is summed.
  // Every source window is tried, throughput before inflow, so sample order does not hide a conserving window.
  const groups = new Map<string, number[]>();
  observation.edges.forEach((edge, edgeIndex) => {
    const key = JSON.stringify([edge.toProcessId, edge.toResourceId]);
    groups.set(key, [...(groups.get(key) ?? []), edgeIndex]);
  });
  const sourcesOf = (edge: FlowEdgeV1): Rated[] => {
    const sourced = rows.filter(
      (row) =>
        row.sample.processId === edge.fromProcessId &&
        row.sample.resourceId === edge.fromResourceId &&
        (row.sample.kind === "throughput" || row.sample.kind === "inflow"),
    );
    return [...sourced.filter((row) => row.sample.kind === "throughput"), ...sourced.filter((row) => row.sample.kind === "inflow")];
  };
  for (const edgeIndexes of groups.values()) {
    const grouped = edgeIndexes.map((edgeIndex) => ({ edge: observation.edges[edgeIndex] as FlowEdgeV1, edgeIndex, sources: [] as Rated[] }));
    for (const item of grouped) item.sources = sourcesOf(item.edge);
    const destination = grouped[0]?.edge;
    if (!destination) continue;
    const windows: Window[] = [];
    for (const item of grouped) {
      for (const row of item.sources) {
        if (!windows.some((window) => window.startSec === row.sample.startSec && window.endSec === row.sample.endSec)) {
          windows.push({ startSec: row.sample.startSec, endSec: row.sample.endSec });
        }
      }
    }
    // The latest conserving window is the fact, whatever the sample order.
    windows.sort((left, right) => right.endSec - left.endSec || right.startSec - left.startSec);
    for (const window of windows) {
      const inputs = grouped.map((item) =>
        item.sources.find((row) => row.sample.startSec === window.startSec && row.sample.endSec === window.endSec),
      );
      if (inputs.some((input) => input === undefined)) continue;
      const present = inputs as Rated[];
      let theoretical = 0;
      for (const [k, input] of present.entries()) {
        const converted = convert(input.value, (grouped[k] as (typeof grouped)[number]).edge);
        theoretical = converted === null ? Number.NaN : theoretical + converted;
      }
      if (!Number.isFinite(theoretical)) continue;
      const queue = sampleAt(rows, destination.toProcessId, destination.toResourceId, "queue", window);
      const unretained = sampleAt(rows, destination.toProcessId, destination.toResourceId, "unretained", window);
      if (!queue || !unretained || queue.sample.unit !== unretained.sample.unit) continue;
      // When the destination's throughput names its unit in this window, the stock must be in that unit.
      const destinationRate = sampleAt(rows, destination.toProcessId, destination.toResourceId, "throughput", window);
      if (destinationRate !== undefined && queue.sample.unit !== destinationRate.sample.unit) continue;
      if (present.some((input) => input.sample.unit === queue.sample.unit)) continue;
      const held = queue.value + unretained.value;
      if (!nearly(held, theoretical)) continue;
      facts.push({
        id: `fact:conservation:${edgeIndexes[0]}`,
        processId: destination.toProcessId,
        kind: "conservation",
        amount: formatDecimal(theoretical),
        unit: queue.sample.unit,
        window,
        evidenceRefs: [
          ...present.map((input) => `sample:${input.index}`),
          `sample:${queue.index}`,
          `sample:${unretained.index}`,
          // The destination throughput that named the stock's unit is cited too.
          ...(destinationRate ? [`sample:${destinationRate.index}`] : []),
          ...edgeIndexes.map((edgeIndex) => `edge:${edgeIndex}`),
        ],
      });
      break;
    }
  }
  const hypotheses: FlowHypothesisV1[] = [];
  // The bind a causal model or experiment names is confirmed and comes first. Other binds stay suspected.
  const causalId = observation.causal?.processId;
  const rankedBindings = [
    ...bindings.filter((bound) => bound.row.sample.processId === causalId),
    ...bindings.filter((bound) => bound.row.sample.processId !== causalId),
  ];
  for (const { row, refs } of rankedBindings) {
    const confirmed = row.sample.processId === causalId;
    hypotheses.push(
      hypothesis(
        row.sample.processId,
        confirmed ? "confirmed" : "suspected",
        "capacity-constraint",
        // A confirmation cites the causal record it rests on, next to the samples.
        confirmed ? [...refs, "causal"] : refs,
        confirmed ? "a causal model or experiment names this saturated process" : "the process is saturated, without a causal model or experiment",
      ),
    );
  }
  // Starved and blocked time are judged per process. One process's wait or bind does not mask another's.
  const bound = new Set(bindings.map((item) => item.row.sample.processId));
  const waits = new Map<string, { starved: Rated[]; blocked: Rated[] }>();
  for (const row of rows) {
    if (bound.has(row.sample.processId)) continue;
    if (row.sample.kind !== "starved-time" && row.sample.kind !== "blocked-time") continue;
    const entry = waits.get(row.sample.processId) ?? { starved: [], blocked: [] };
    (row.sample.kind === "starved-time" ? entry.starved : entry.blocked).push(row);
    waits.set(row.sample.processId, entry);
  }
  // Each wait kind is read from its latest window, whatever the sample order. Every resource's sample in that
  // window counts, and a latest window with no positive wait clears an older one.
  const positiveInLatest = (samples: readonly Rated[]): Rated[] => {
    const newest = latest(samples);
    if (!newest) return [];
    return samples.filter(
      (row) => row.sample.startSec === newest.sample.startSec && row.sample.endSec === newest.sample.endSec && row.value > 0,
    );
  };
  const refsOf = (samples: readonly Rated[]): string[] => samples.map((row) => `sample:${row.index}`);
  for (const [processId, kinds] of waits) {
    const starved = positiveInLatest(kinds.starved);
    const blocked = positiveInLatest(kinds.blocked);
    if (starved.length > 0 && blocked.length === 0) {
      hypotheses.push(hypothesis(processId, "suspected", "material-shortage", refsOf(starved), "starved time was observed without a capacity bind"));
    } else if (blocked.length > 0 && starved.length === 0) {
      hypotheses.push(hypothesis(processId, "suspected", "demand-shortage", refsOf(blocked), "blocked time was observed without a capacity bind"));
    } else if (starved.length > 0 && blocked.length > 0) {
      hypotheses.push(
        hypothesis(
          processId,
          "insufficient-data",
          "none",
          [...refsOf(starved), ...refsOf(blocked)],
          "starved and blocked time were both observed on this process",
        ),
      );
    }
  }
  if (hypotheses.length === 0) {
    hypotheses.push(hypothesis(null, "insufficient-data", "none", [], "demand and capacity were not both observed"));
  }
  const conserved = facts.some((fact) => fact.kind === "conservation");
  const resolved = hypotheses.some((item) => item.status === "confirmed" || item.status === "suspected");
  return {
    schemaVersion: 1,
    contract: "idlekit.flow.v1",
    algorithmVersion: FLOW_ALGORITHM_VERSION,
    capability: observation.capability,
    // A lone final throughput is a fact, not a diagnosis.
    status: resolved || conserved ? "ok" : "insufficient-data",
    facts,
    hypotheses,
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
