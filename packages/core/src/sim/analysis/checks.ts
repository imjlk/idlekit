import typia, { type IValidation } from "typia";

/**
 * Game-scenario balance gate. This is not a ttsc, Evidence, or Graph quality gate.
 * ScenarioV1.outputs.assertions stay declaration-only; this module does not execute them.
 * A numeric verdict never reads the advisory string and never calls a network service.
 */

export type CheckOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "between";
export type CheckSeverity = "error" | "warn";
export type MissingPolicy = "inconclusive" | "fail" | "unsupported";
export type CheckVerdict = "pass" | "fail" | "inconclusive" | "unsupported";
export type ObservationStatus = "measured" | "censored" | "missing" | "unknown" | "unsupported";
export type FailOnToken = "error" | "warn" | "inconclusive" | "unsupported";

export type BalanceIdentityV1 = Readonly<{
  metricId: string;
  definition: string;
  method: string;
  scenarioVersion: string;
  specVersion: string;
  engineId: string;
  pluginVersion: string;
  seed: string;
  unit: string;
  algorithmVersion: string;
}>;

export type BalanceObservationV1 = Readonly<{
  identity: BalanceIdentityV1;
  status: ObservationStatus;
  value: number | null;
  lower: number | null;
  upper: number | null;
}>;

export type BalanceCheckV1 = Readonly<{
  id: string;
  metricId: string;
  operator: CheckOperator;
  threshold: number;
  upperThreshold: number | null;
  unit: string;
  severity: CheckSeverity;
  missingPolicy: MissingPolicy;
  definition: string;
  method: string;
  scenarioVersion: string | null;
  specVersion: string | null;
  engineId: string | null;
  pluginVersion: string | null;
  seed: string | null;
  algorithmVersion: string | null;
}>;

export type BalanceCheckRequestV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.balance-checks.v1";
  failOn: readonly FailOnToken[];
  checks: readonly BalanceCheckV1[];
  observations: readonly BalanceObservationV1[];
  advisory: string | null;
}>;

export type BalanceEvidenceV1 = Readonly<{
  status: ObservationStatus | "absent";
  value: number | null;
  lower: number | null;
  upper: number | null;
  operator: CheckOperator;
  threshold: number;
  upperThreshold: number | null;
  unit: string;
}>;

export type BalanceCheckResultV1 = Readonly<{
  id: string;
  metricId: string;
  severity: CheckSeverity;
  verdict: CheckVerdict;
  reason: string;
  mismatches: readonly string[];
  evidence: BalanceEvidenceV1;
}>;

export type BalanceCheckReportV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.balance-checks.v1";
  algorithmVersion: "balance-checks-1";
  failOn: readonly FailOnToken[];
  pass: boolean;
  exitCode: 0 | 2;
  results: readonly BalanceCheckResultV1[];
  advisory: string | null;
  baselineRewrite: false;
  externalProvider: false;
}>;

export type BalanceCheckErrorV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.balance-checks.v1";
  kind: "balance-check-error";
  exitCode: 2;
  failed: readonly BalanceCheckResultV1[];
  advisory: string | null;
  baselineRewrite: false;
  externalProvider: false;
}>;

export type BalanceCheckDocumentV1 = BalanceCheckReportV1 | BalanceCheckErrorV1;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-check-spec A check names a registered metric, operator, threshold, unit, severity, and missing policy.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-check-spec #d7f7211 Re-read the section: the default path is a data spec, not an arbitrary expression.
 */
export const balanceCheckSpec = "registered-check-spec" as const;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-verdict-bounds Pass and fail come only from a measured point or a bound that decides the comparison.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-verdict-bounds #7c48cdf Re-read the section: a missing or unknown value is not zero, and a censored lower bound can fail.
 */
export const balanceVerdictBounds = "bounds-not-zero" as const;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-identity-mismatch A different definition, method, version, seed, engine, or unit is a mismatch and is not rewritten.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-identity-mismatch #b9af2a2 Re-read the section: mismatch stays inconclusive and baselineRewrite stays false.
 */
export const balanceIdentityMismatch = "mismatch-not-rewritten" as const;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-kpi-adapter The existing a/b horizon report is mapped into this engine.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-kpi-adapter #9f228f6 Re-read the section: identical fixture rows pass and a lower worth fails.
 */
export const balanceKpiAdapter = "kpi-adapter" as const;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-assertion-grammar Scenario assertions are declaration-only. The supported grammar is the safe comparison term.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-assertion-grammar #2ad185e Re-read the section: an unsafe expression is unsupported and is not executed.
 */
export const balanceAssertionGrammar = "declaration-only" as const;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-numeric-advisory The numeric verdict and the advisory text are separate, and the default path does not fetch.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-numeric-advisory #80bc2bf Re-read the section: advisory text cannot turn a fail into a pass.
 */
export const balanceNumericAdvisory = "numeric-not-advisory" as const;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-failure-report A blocking result exits 2 and the error document validates.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-failure-report #fd8c2d1 Re-read the section: unsupported, error, and missing do not become pass.
 */
export const balanceFailureReport = "failure-exit-two" as const;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateRequestValidator: ((input: unknown) => IValidation<BalanceCheckRequestV1>) | undefined;
let validateBalanceCheckReportValidator: ((input: unknown) => IValidation<BalanceCheckDocumentV1>) | undefined;

const validateRequest = (input: unknown): IValidation<BalanceCheckRequestV1> =>
  (validateRequestValidator ??= typia.createValidate<BalanceCheckRequestV1>())(input);

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-failure-report The published validator is createValidate of the balance document.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-failure-report #fd8c2d1 Re-read the section: the error kind validates with the report.
 */
export const validateBalanceCheckReport = (input: unknown): IValidation<BalanceCheckDocumentV1> =>
  (validateBalanceCheckReportValidator ??= typia.createValidate<BalanceCheckDocumentV1>())(input);

function buildBalanceChecksJsonSchema() {
  return typia.json.schema<BalanceCheckDocumentV1, "3.1">();
}

let balanceChecksJsonSchemaUnit: ReturnType<typeof buildBalanceChecksJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-failure-report The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-failure-report #fd8c2d1 Re-read the section: schema version is 3.1 and the contract id is idlekit.balance-checks.v1.
 */
export function balanceChecksJsonSchema(): ReturnType<typeof buildBalanceChecksJsonSchema> {
  balanceChecksJsonSchemaUnit ??= buildBalanceChecksJsonSchema();
  return balanceChecksJsonSchemaUnit;
}

export function balanceChecksSchemaId(): "https://idlekit.dev/schemas/balance-checks.v1.schema.json" {
  return "https://idlekit.dev/schemas/balance-checks.v1.schema.json";
}

export function balanceChecksAlgorithmVersion(): "balance-checks-1" {
  return "balance-checks-1";
}

const FAIL_ON: readonly FailOnToken[] = ["error", "warn", "inconclusive", "unsupported"];

export function parseFailOn(raw: string): readonly FailOnToken[] | null {
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => !FAIL_ON.includes(part as FailOnToken))) return null;
  return parts as FailOnToken[];
}

export function parseBalanceCheckRequest(
  input: unknown,
): { ok: true; request: BalanceCheckRequestV1 } | { ok: false; issues: readonly string[] } {
  const validated = validateRequest(input);
  if (validated.success) {
    // An empty gate is not a pass. A check file must name at least one check.
    if (validated.data.checks.length === 0) return { ok: false, issues: ["$input.checks at least one check"] };
    return { ok: true, request: validated.data };
  }
  return {
    ok: false,
    issues: validated.errors.map((error) => `${error.path} ${error.expected}`),
  };
}

type AssertionOp = "<" | "<=" | "==" | "!=" | ">=" | ">";
export type AssertionTerm = Readonly<{ path: string; op: AssertionOp; value: string }>;

const ASSERTION_TERM = /^([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|==|!=|<|>)\s*([^\s&|]+)$/;

export function classifyAssertionExpr(
  expr: string,
): { status: "supported"; terms: readonly (readonly AssertionTerm[])[] } | { status: "unsupported"; reason: string } {
  if (expr.trim().length === 0) return { status: "unsupported", reason: "empty assertion" };
  // Empty clauses are kept, so `a <= 1 ||` and `a <= 1 && && b >= 2` stay outside the grammar.
  const disjunction = expr.split("||").map((part) => part.trim());
  const terms: AssertionTerm[][] = [];
  for (const clause of disjunction) {
    if (clause.length === 0) return { status: "unsupported", reason: "empty clause" };
    const conjunction = clause.split("&&").map((part) => part.trim());
    if (conjunction.some((part) => part.length === 0)) return { status: "unsupported", reason: "empty term" };
    const parsed: AssertionTerm[] = [];
    for (const raw of conjunction) {
      const match = ASSERTION_TERM.exec(raw);
      if (!match?.[1] || !match[2] || !match[3]) {
        return { status: "unsupported", reason: "term is not path, operator, value" };
      }
      parsed.push({ path: match[1], op: match[2] as AssertionOp, value: match[3] });
    }
    terms.push(parsed);
  }
  return { status: "supported", terms };
}

function finite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function jsonNumber(value: number | null): number | null {
  return finite(value) ? value : null;
}

function pointSatisfies(operator: CheckOperator, value: number, threshold: number, upper: number | null): boolean | "unsupported" {
  if (operator === "between") {
    if (!finite(upper) || !finite(threshold) || threshold > upper) return "unsupported";
    if (!finite(value)) return false;
    return value >= threshold && value <= upper;
  }
  if (!finite(threshold) || !finite(value)) return false;
  if (operator === "lt") return value < threshold;
  if (operator === "lte") return value <= threshold;
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  return value === threshold;
}

function measuredVerdict(operator: CheckOperator, threshold: number, upper: number | null, value: number): CheckVerdict {
  if (Number.isNaN(value)) return "inconclusive";
  if (value === Number.POSITIVE_INFINITY) {
    if (operator === "gt" || operator === "gte") return finite(threshold) ? "pass" : "unsupported";
    return "fail";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    if (operator === "lt" || operator === "lte") return finite(threshold) ? "pass" : "unsupported";
    return "fail";
  }
  const satisfied = pointSatisfies(operator, value, threshold, upper);
  if (satisfied === "unsupported") return "unsupported";
  return satisfied ? "pass" : "fail";
}

function intervalVerdict(
  operator: CheckOperator,
  threshold: number,
  upperThreshold: number | null,
  lower: number | null,
  upper: number | null,
): CheckVerdict {
  const low = finite(lower) ? lower : null;
  const high = finite(upper) ? upper : null;
  // Contradictory bounds describe no value, so they cannot decide a comparison.
  if (low !== null && high !== null && low > high) return "inconclusive";
  if (operator === "between") {
    if (!finite(upperThreshold) || !finite(threshold) || threshold > upperThreshold) return "unsupported";
    if (low !== null && high !== null && low >= threshold && high <= upperThreshold) return "pass";
    if ((high !== null && high < threshold) || (low !== null && low > upperThreshold)) return "fail";
    return "inconclusive";
  }
  if (!finite(threshold)) return "unsupported";
  if (operator === "lt") {
    if (high !== null && high < threshold) return "pass";
    if (low !== null && low >= threshold) return "fail";
    return "inconclusive";
  }
  if (operator === "lte") {
    if (high !== null && high <= threshold) return "pass";
    if (low !== null && low > threshold) return "fail";
    return "inconclusive";
  }
  if (operator === "gt") {
    if (low !== null && low > threshold) return "pass";
    if (high !== null && high <= threshold) return "fail";
    return "inconclusive";
  }
  if (operator === "gte") {
    if (low !== null && low >= threshold) return "pass";
    if (high !== null && high < threshold) return "fail";
    return "inconclusive";
  }
  if (low !== null && high !== null && low === threshold && high === threshold) return "pass";
  if ((high !== null && high < threshold) || (low !== null && low > threshold)) return "fail";
  return "inconclusive";
}

function identityMismatches(check: BalanceCheckV1, observation: BalanceObservationV1): string[] {
  const found: string[] = [];
  const identity = observation.identity;
  if (identity.metricId !== check.metricId) found.push("metricId");
  if (identity.definition !== check.definition) found.push("definition");
  if (identity.method !== check.method) found.push("method");
  if (identity.unit !== check.unit) found.push("unit");
  if (check.scenarioVersion !== null && identity.scenarioVersion !== check.scenarioVersion) found.push("scenarioVersion");
  if (check.specVersion !== null && identity.specVersion !== check.specVersion) found.push("specVersion");
  if (check.engineId !== null && identity.engineId !== check.engineId) found.push("engineId");
  if (check.pluginVersion !== null && identity.pluginVersion !== check.pluginVersion) found.push("pluginVersion");
  if (check.seed !== null && identity.seed !== check.seed) found.push("seed");
  if (check.algorithmVersion !== null && identity.algorithmVersion !== check.algorithmVersion) {
    found.push("algorithmVersion");
  }
  return found;
}

function evidenceOf(check: BalanceCheckV1, observation: BalanceObservationV1 | undefined): BalanceEvidenceV1 {
  const hide = !observation || observation.status === "missing" || observation.status === "unsupported";
  return {
    status: observation?.status ?? "absent",
    value: hide ? null : jsonNumber(observation.value),
    lower: hide ? null : jsonNumber(observation.lower),
    upper: hide ? null : jsonNumber(observation.upper),
    operator: check.operator,
    threshold: check.threshold,
    upperThreshold: check.upperThreshold,
    unit: check.unit,
  };
}

type ObservationMatch =
  | Readonly<{ kind: "one"; observation: BalanceObservationV1 | undefined }>
  | Readonly<{ kind: "ambiguous"; count: number }>;

/**
 * Select by the identity the check declares, not by metric id alone. A later observation
 * that matches every pinned field wins over an earlier mismatch. Two full matches are ambiguous.
 */
function matchObservation(check: BalanceCheckV1, observations: readonly BalanceObservationV1[]): ObservationMatch {
  const sameMetric = observations.filter((observation) => observation.identity.metricId === check.metricId);
  const exact = sameMetric.filter((observation) => identityMismatches(check, observation).length === 0);
  if (exact.length > 1) return { kind: "ambiguous", count: exact.length };
  return { kind: "one", observation: exact[0] ?? sameMetric[0] };
}

function judgeOne(check: BalanceCheckV1, match: ObservationMatch): BalanceCheckResultV1 {
  if (match.kind === "ambiguous") {
    return {
      id: check.id,
      metricId: check.metricId,
      severity: check.severity,
      verdict: "inconclusive",
      reason: `ambiguous ${match.count} observations match the check identity`,
      mismatches: [],
      evidence: evidenceOf(check, undefined),
    };
  }
  const observation = match.observation;
  const evidence = evidenceOf(check, observation);
  if (!observation) {
    return {
      id: check.id,
      metricId: check.metricId,
      severity: check.severity,
      verdict: check.missingPolicy,
      reason: "required metric is absent",
      mismatches: [],
      evidence,
    };
  }
  const mismatches = identityMismatches(check, observation);
  if (mismatches.length > 0) {
    return {
      id: check.id,
      metricId: check.metricId,
      severity: check.severity,
      verdict: "inconclusive",
      reason: `mismatch ${mismatches.join(",")}`,
      mismatches,
      evidence,
    };
  }
  if (observation.status === "missing") {
    return {
      id: check.id,
      metricId: check.metricId,
      severity: check.severity,
      verdict: check.missingPolicy,
      reason: "required metric is missing",
      mismatches: [],
      evidence,
    };
  }
  if (observation.status === "unsupported") {
    return {
      id: check.id,
      metricId: check.metricId,
      severity: check.severity,
      verdict: "unsupported",
      reason: "metric is unsupported",
      mismatches: [],
      evidence,
    };
  }
  if (observation.status === "measured") {
    if (!finite(observation.value) && observation.value !== Number.POSITIVE_INFINITY && observation.value !== Number.NEGATIVE_INFINITY) {
      return {
        id: check.id,
        metricId: check.metricId,
        severity: check.severity,
        verdict: "inconclusive",
        reason: "measured value is absent",
        mismatches: [],
        evidence,
      };
    }
    const verdict = measuredVerdict(check.operator, check.threshold, check.upperThreshold, observation.value as number);
    return {
      id: check.id,
      metricId: check.metricId,
      severity: check.severity,
      verdict,
      reason: verdict === "pass" ? "measured point satisfies the check" : "measured point does not satisfy the check",
      mismatches: [],
      evidence,
    };
  }
  const verdict = intervalVerdict(check.operator, check.threshold, check.upperThreshold, observation.lower, observation.upper);
  const inverted = finite(observation.lower) && finite(observation.upper) && observation.lower > observation.upper;
  return {
    id: check.id,
    metricId: check.metricId,
    severity: check.severity,
    verdict,
    reason: inverted
      ? "bounds are contradictory"
      : verdict === "inconclusive"
        ? "bounds do not decide the comparison"
        : "bounds decide the comparison",
    mismatches: [],
    evidence,
  };
}

function blocks(result: BalanceCheckResultV1, failOn: readonly FailOnToken[]): boolean {
  if (result.verdict === "pass") return false;
  if (result.verdict === "fail") return failOn.includes(result.severity);
  return failOn.includes(result.verdict) || failOn.includes(result.severity);
}

export function evaluateBalanceChecks(request: BalanceCheckRequestV1): BalanceCheckReportV1 {
  const results = request.checks.map((check) => judgeOne(check, matchObservation(check, request.observations)));
  const pass = results.every((result) => !blocks(result, request.failOn));
  return {
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    algorithmVersion: "balance-checks-1",
    failOn: request.failOn,
    pass,
    exitCode: pass ? 0 : 2,
    results,
    advisory: request.advisory,
    baselineRewrite: false,
    externalProvider: false,
  };
}

export function toBalanceCheckError(report: BalanceCheckReportV1): BalanceCheckErrorV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    kind: "balance-check-error",
    exitCode: 2,
    failed: report.results.filter((result) => blocks(result, report.failOn)),
    advisory: report.advisory,
    baselineRewrite: false,
    externalProvider: false,
  };
}

export function renderBalanceCheckMarkdown(report: BalanceCheckReportV1 | BalanceCheckErrorV1): string {
  const failed = "failed" in report ? report.failed : report.results.filter((result) => result.verdict !== "pass");
  const lines = ["# Balance checks", "", `Pass: ${"pass" in report ? report.pass : false}`, "", "## Failed metrics", ""];
  if (failed.length === 0) lines.push("None.");
  for (const row of failed) {
    lines.push(`- ${row.metricId} (${row.id}): ${row.verdict} ${row.severity}`);
    lines.push(
      `  - evidence status ${row.evidence.status} value ${String(row.evidence.value)} lower ${String(row.evidence.lower)} upper ${String(row.evidence.upper)} ${row.evidence.operator} ${row.evidence.threshold} ${row.evidence.unit}`,
    );
    if (row.mismatches.length > 0) lines.push(`  - mismatch ${row.mismatches.join(", ")}`);
    lines.push(`  - ${row.reason}`);
  }
  if (report.advisory) {
    lines.push("", "## Advisory", "", report.advisory, "", "Advisory is not a pass or fail.");
  }
  return lines.join("\n");
}

type KpiSide = "a" | "b";
type KpiHorizon = "at7d" | "at30d" | "at90d";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readHorizon(report: unknown, side: KpiSide, horizon: KpiHorizon): Record<string, unknown> {
  const root = asRecord(report);
  const ltv = asRecord(root?.ltv);
  const sideRow = asRecord(ltv?.[side]);
  const summary = asRecord(sideRow?.summary);
  const row = asRecord(summary?.[horizon]);
  if (!row) throw new Error(`Missing horizon '${horizon}' for side '${side}'`);
  return row;
}

function toLog10(value: unknown): number {
  if (typeof value === "number") {
    if (value <= 0) return Number.NEGATIVE_INFINITY;
    return Math.log10(value);
  }
  if (typeof value !== "string") throw new Error(`Expected numeric string, got ${typeof value}`);
  const text = value.trim().toLowerCase();
  if (!text || text === "0") return Number.NEGATIVE_INFINITY;
  const asNum = Number(text);
  if (Number.isFinite(asNum) && asNum > 0) return Math.log10(asNum);
  const sci = text.match(/^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/);
  if (sci) {
    const mantissa = Number(sci[1] ?? "");
    const exponent = Number(sci[2] ?? "");
    if (!Number.isFinite(mantissa) || !Number.isFinite(exponent) || mantissa <= 0) {
      throw new Error(`Invalid numeric string: ${value}`);
    }
    return Math.log10(mantissa) + exponent;
  }
  throw new Error(`Unsupported numeric string: ${value}`);
}

function kpiIdentity(metricId: string, unit: string): BalanceIdentityV1 {
  return {
    metricId,
    definition: "kpi-regress-v1",
    method: "legacy-delta",
    scenarioVersion: "kpi-report",
    specVersion: "kpi-regress",
    engineId: "kpi-report",
    pluginVersion: "kpi-report",
    seed: "kpi-regress",
    unit,
    algorithmVersion: "balance-checks-1",
  };
}

function kpiCheck(id: string, metricId: string, operator: CheckOperator, threshold: number, unit: string): BalanceCheckV1 {
  return {
    id,
    metricId,
    operator,
    threshold,
    upperThreshold: null,
    unit,
    severity: "error",
    missingPolicy: "fail",
    definition: "kpi-regress-v1",
    method: "legacy-delta",
    scenarioVersion: "kpi-report",
    specVersion: "kpi-regress",
    engineId: "kpi-report",
    pluginVersion: "kpi-report",
    seed: "kpi-regress",
    algorithmVersion: "balance-checks-1",
  };
}

function measured(metricId: string, unit: string, value: number): BalanceObservationV1 {
  return {
    identity: kpiIdentity(metricId, unit),
    status: "measured",
    value,
    lower: value,
    upper: value,
  };
}

export type KpiRegressionInput = Readonly<{
  baseline: unknown;
  current: unknown;
  baselinePath: string;
  currentPath: string;
  generatedAt: string;
  minWorthRatio: number;
  maxStallDelta: number;
  maxDroppedDelta: number;
  minVisibleProgressRatio: number;
  maxNoRewardGapDelta: number;
}>;

export function adaptKpiRegression(input: KpiRegressionInput) {
  const horizons: KpiHorizon[] = ["at7d", "at30d", "at90d"];
  const sides: KpiSide[] = ["a", "b"];
  const minWorthLog10Delta = Math.log10(input.minWorthRatio);
  const checks: BalanceCheckV1[] = [];
  const observations: BalanceObservationV1[] = [];
  const rows: Array<{
    side: KpiSide;
    horizon: KpiHorizon;
    baseline: { endNetWorth: string; stallRatio: number; droppedRate: number };
    current: { endNetWorth: string; stallRatio: number; droppedRate: number };
    deltas: { endWorthLog10: number; stallRatio: number; droppedRate: number };
    ids: { worth: string; stall: string; dropped: string };
  }> = [];

  for (const side of sides) {
    for (const horizon of horizons) {
      const baseline = readHorizon(input.baseline, side, horizon);
      const current = readHorizon(input.current, side, horizon);
      const baselineWorth = String(baseline.endNetWorth ?? "");
      const currentWorth = String(current.endNetWorth ?? "");
      const baselineGuard = asRecord(baseline.guardrails);
      const currentGuard = asRecord(current.guardrails);
      const baselineStall = Number(baselineGuard?.stallRatio ?? 0);
      const currentStall = Number(currentGuard?.stallRatio ?? 0);
      const baselineDropped = Number(baselineGuard?.droppedRate ?? 0);
      const currentDropped = Number(currentGuard?.droppedRate ?? 0);
      const worthDelta = toLog10(currentWorth) - toLog10(baselineWorth);
      const stallDelta = currentStall - baselineStall;
      const droppedDelta = currentDropped - baselineDropped;
      const worthId = `${side}:${horizon}:worth`;
      const stallId = `${side}:${horizon}:stall`;
      const droppedId = `${side}:${horizon}:dropped`;
      const worthMetric = `${worthId}:endNetWorthLog10Delta`;
      const stallMetric = `${stallId}:stallRatioDelta`;
      const droppedMetric = `${droppedId}:droppedRateDelta`;
      checks.push(kpiCheck(worthId, worthMetric, "gte", minWorthLog10Delta, "log10"));
      checks.push(kpiCheck(stallId, stallMetric, "lte", input.maxStallDelta, "ratio"));
      checks.push(kpiCheck(droppedId, droppedMetric, "lte", input.maxDroppedDelta, "ratio"));
      observations.push(measured(worthMetric, "log10", worthDelta));
      observations.push(measured(stallMetric, "ratio", stallDelta));
      observations.push(measured(droppedMetric, "ratio", droppedDelta));
      rows.push({
        side,
        horizon,
        baseline: { endNetWorth: baselineWorth, stallRatio: baselineStall, droppedRate: baselineDropped },
        current: { endNetWorth: currentWorth, stallRatio: currentStall, droppedRate: currentDropped },
        deltas: { endWorthLog10: worthDelta, stallRatio: stallDelta, droppedRate: droppedDelta },
        ids: { worth: worthId, stall: stallId, dropped: droppedId },
      });
    }
  }

  const experienceRows = sides.map((side) => {
    const baselineRoot = asRecord(input.baseline);
    const currentRoot = asRecord(input.current);
    const baselinePerceived = asRecord(asRecord(asRecord(baselineRoot?.experience)?.[side])?.perceived) ?? {};
    const currentPerceived = asRecord(asRecord(asRecord(currentRoot?.experience)?.[side])?.perceived) ?? {};
    const baselineVisible = Number(baselinePerceived.visibleChangesPerMinute ?? 0);
    const currentVisible = Number(currentPerceived.visibleChangesPerMinute ?? 0);
    const baselineGap = Number(baselinePerceived.maxNoRewardGapSec ?? 0);
    const currentGap = Number(currentPerceived.maxNoRewardGapSec ?? 0);
    const visibleRatio = baselineVisible <= 0 ? (currentVisible > 0 ? Number.POSITIVE_INFINITY : 1) : currentVisible / baselineVisible;
    const gapDelta = currentGap - baselineGap;
    const visibleId = `${side}:visible`;
    const gapId = `${side}:noReward`;
    const visibleMetric = `${visibleId}:visibleChangesPerMinuteRatio`;
    const gapMetric = `${gapId}:maxNoRewardGapSecDelta`;
    checks.push(kpiCheck(visibleId, visibleMetric, "gte", input.minVisibleProgressRatio, "ratio"));
    checks.push(kpiCheck(gapId, gapMetric, "lte", input.maxNoRewardGapDelta, "s"));
    observations.push(measured(visibleMetric, "ratio", visibleRatio));
    observations.push(measured(gapMetric, "s", gapDelta));
    return {
      side,
      baseline: { visibleChangesPerMinute: baselineVisible, maxNoRewardGapSec: baselineGap },
      current: { visibleChangesPerMinute: currentVisible, maxNoRewardGapSec: currentGap },
      deltas: { visibleRatio, noRewardGapSec: gapDelta },
      ids: { visible: visibleId, gap: gapId },
    };
  });

  const balanceChecks = evaluateBalanceChecks({
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    failOn: ["error"],
    checks,
    observations,
    advisory: null,
  });
  const verdict = new Map(balanceChecks.results.map((result) => [result.id, result.verdict === "pass"]));
  const legacyChecks = rows.map((row) => {
    const worth = verdict.get(row.ids.worth) === true;
    const stallRatio = verdict.get(row.ids.stall) === true;
    const droppedRate = verdict.get(row.ids.dropped) === true;
    return {
      side: row.side,
      horizon: row.horizon,
      baseline: row.baseline,
      current: row.current,
      deltas: row.deltas,
      thresholds: {
        minWorthLog10Delta,
        maxStallDelta: input.maxStallDelta,
        maxDroppedDelta: input.maxDroppedDelta,
      },
      pass: { worth, stallRatio, droppedRate, overall: worth && stallRatio && droppedRate },
    };
  });
  const experienceChecks = experienceRows.map((row) => {
    const visibleProgress = verdict.get(row.ids.visible) === true;
    const noRewardGap = verdict.get(row.ids.gap) === true;
    return {
      side: row.side,
      baseline: row.baseline,
      current: row.current,
      deltas: row.deltas,
      thresholds: {
        minVisibleProgressRatio: input.minVisibleProgressRatio,
        maxNoRewardGapDelta: input.maxNoRewardGapDelta,
      },
      pass: { visibleProgress, noRewardGap, overall: visibleProgress && noRewardGap },
    };
  });
  const pass = legacyChecks.every((row) => row.pass.overall) && experienceChecks.every((row) => row.pass.overall);
  return {
    baselinePath: input.baselinePath,
    currentPath: input.currentPath,
    generatedAt: input.generatedAt,
    thresholds: {
      minWorthRatio: input.minWorthRatio,
      maxStallDelta: input.maxStallDelta,
      maxDroppedDelta: input.maxDroppedDelta,
      minVisibleProgressRatio: input.minVisibleProgressRatio,
      maxNoRewardGapDelta: input.maxNoRewardGapDelta,
    },
    pass,
    checks: legacyChecks,
    experienceChecks,
    balanceChecks,
  };
}
