import typia, { type IValidation } from "typia";
import {
  analysisAlgorithmVersion,
  validateAnalysisSemantics,
  type AnalysisArtifactV1,
  type MetricReadingV1,
} from "./contracts";
import {
  evaluateBalanceChecks,
  type BalanceCheckReportV1,
  type BalanceCheckV1,
  type BalanceObservationV1,
  type CheckOperator,
  type CheckSeverity,
  type FailOnToken,
  type MissingPolicy,
} from "./checks";

/**
 * Optional rules judge. It reads a finished analysis artifact and a versioned rubric.
 * Numeric comparisons go through the balance-check engine. This module does not run a simulation,
 * does not rewrite that engine's report, and does not call an external provider.
 */

const JUDGE_SCHEMA_ID = "https://idlekit.dev/schemas/judge.output.schema.json" as const;
const JUDGE_ALGORITHM_VERSION = "judge-rules-1" as const;

export function judgeSchemaId(): typeof JUDGE_SCHEMA_ID {
  return JUDGE_SCHEMA_ID;
}

export function judgeAlgorithmVersion(): typeof JUDGE_ALGORITHM_VERSION {
  return JUDGE_ALGORITHM_VERSION;
}

export type RecommendationId =
  | "rec.metric.within-threshold"
  | "rec.metric.outside-threshold"
  | "rec.metric.insufficient"
  | "rec.metric.estimate-not-measured"
  | "rec.metric.unsupported"
  | "rec.metric.identity-mismatch";

export type JudgeLayer = "rule" | "estimate" | "semantic";
export type DiagnosticStatus = "conflict" | "insufficient" | "unsupported" | "noted" | "indeterminate";

export type JudgeRuleV1 = Readonly<{
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
  recommendationId: RecommendationId;
}>;

export type JudgeRubricV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.judge.rubric.v1";
  rubricVersion: string;
  failOn: readonly FailOnToken[];
  rules: readonly JudgeRuleV1[];
}>;

export type JudgeDiagnosticV1 = Readonly<{
  id: string;
  category: JudgeLayer;
  severity: "error" | "warn" | "info";
  evidenceRefs: readonly string[];
  assumptionRefs: readonly string[];
  recommendationId: RecommendationId;
  status: DiagnosticStatus;
  text: Readonly<{ en: string; ko: string }>;
}>;

export type EstimatedObservationV1 = Readonly<{
  metricId: string;
  value: number | null;
  reason: string | null;
}>;

export type JudgeReportV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.judge.v1";
  algorithmVersion: typeof JUDGE_ALGORITHM_VERSION;
  provider: "rules";
  rubricVersion: string;
  advisoryDigest: string;
  numerical: BalanceCheckReportV1;
  estimatedObservations: readonly EstimatedObservationV1[];
  diagnostics: readonly JudgeDiagnosticV1[];
  externalProvider: false;
  baselineRewrite: false;
}>;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider The provider is rules. The output contract does not carry a vendor response.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider #bb58b8a Re-read the section: provider is rules and externalProvider is false.
 */
export const judgeRulesProvider = "rules-not-vendor" as const;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-check-reuse A numeric threshold is decided by the balance-check engine.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-check-reuse #33488b3 Re-read the section: the judge does not recompute the metric.
 */
export const judgeCheckReuse = "checks-not-recomputed" as const;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-evidence-refs A rubric ref must name a metric that exists on the artifact.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-evidence-refs #a078dea Re-read the section: a bad version or a missing ref is rejected.
 */
export const judgeEvidenceRefs = "existing-refs-only" as const;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-separated-report Numerical results, estimates, and semantic notes stay in separate fields.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-separated-report #0fb3aa6 Re-read the section: a conflict does not rewrite the numerical verdict.
 */
export const judgeSeparatedReport = "layers-stay-apart" as const;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-insufficient Missing information stays insufficient.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-insufficient #ed2626d Re-read the section: the report does not assign a health label.
 */
export const judgeInsufficient = "not-a-health-label" as const;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateJudgeReportValidator: ((input: unknown) => IValidation<JudgeReportV1>) | undefined;
let validateRubricValidator: ((input: unknown) => IValidation<JudgeRubricV1>) | undefined;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider The published validator is createValidate of the judge report.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider #bb58b8a Re-read the section: the structural document is JudgeReportV1.
 */
export const validateJudgeReport = (input: unknown): IValidation<JudgeReportV1> =>
  (validateJudgeReportValidator ??= typia.createValidate<JudgeReportV1>())(input);

function buildJudgeJsonSchema() {
  return typia.json.schema<JudgeReportV1, "3.1">();
}

let judgeJsonSchemaUnit: ReturnType<typeof buildJudgeJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider #bb58b8a Re-read the section: schema version is 3.1 and the contract id is idlekit.judge.v1.
 */
export function judgeJsonSchema(): ReturnType<typeof buildJudgeJsonSchema> {
  judgeJsonSchemaUnit ??= buildJudgeJsonSchema();
  return judgeJsonSchemaUnit;
}

// Equals validation: an unknown rubric field is rejected, not ignored.
const validateRubric = (input: unknown): IValidation<JudgeRubricV1> =>
  (validateRubricValidator ??= typia.createValidateEquals<JudgeRubricV1>())(input);

const TEMPLATES: Readonly<Record<RecommendationId, Readonly<{ en: string; ko: string }>>> = {
  "rec.metric.within-threshold": {
    en: "Metric {metricId} meets the rubric threshold. This note does not rewrite the numerical verdict.",
    ko: "지표 {metricId}가 rubric threshold를 만족한다. 이 문장은 수치 verdict를 바꾸지 않는다.",
  },
  "rec.metric.outside-threshold": {
    en: "Metric {metricId} conflicts with the rubric threshold. The numerical verdict stays as recorded.",
    ko: "지표 {metricId}가 rubric threshold와 충돌한다. 수치 verdict는 기록된 그대로다.",
  },
  "rec.metric.insufficient": {
    en: "Metric {metricId} has no measured value. The rules provider does not fill one in.",
    ko: "지표 {metricId}의 측정값이 없다. rules provider는 값을 채우지 않는다.",
  },
  "rec.metric.estimate-not-measured": {
    en: "Metric {metricId} is an estimate. It is not used as a measured numerical fact.",
    ko: "지표 {metricId}는 추정이다. 측정된 수치 사실로 쓰지 않는다.",
  },
  "rec.metric.unsupported": {
    en: "Metric {metricId} cannot be compared by the rules provider.",
    ko: "지표 {metricId}는 rules provider가 비교할 수 없다.",
  },
  "rec.metric.identity-mismatch": {
    en: "Metric {metricId} was measured under a different identity than the rubric rule names. It is not compared.",
    ko: "지표 {metricId}는 rubric rule이 적은 것과 다른 동일성으로 측정되었다. 비교하지 않는다.",
  },
};

export function parseJudgeRubric(
  input: unknown,
): { ok: true; rubric: JudgeRubricV1 } | { ok: false; issues: readonly string[] } {
  const validated = validateRubric(input);
  if (!validated.success) {
    return { ok: false, issues: validated.errors.map((error) => `${error.path} ${error.expected}`) };
  }
  if (validated.data.rules.length === 0) return { ok: false, issues: ["rubric has no rules"] };
  return { ok: true, rubric: validated.data };
}

function findReadings(artifact: AnalysisArtifactV1, metricId: string): readonly MetricReadingV1[] {
  return artifact.metrics.filter((reading) => reading.metricId === metricId);
}

function isUnavailable(reading: MetricReadingV1): boolean {
  return reading.reading === "unavailable" || reading.status !== "ok";
}

/**
 * Coverage the artifact itself cannot vouch for. A value observed under an unknown metrics
 * capability or incomplete coverage is not a measured fact; it stays insufficient.
 */
function coverageWithheld(artifact: AnalysisArtifactV1): boolean {
  const coverage = artifact.observationCoverage;
  const metrics = artifact.capabilities.metrics;
  return coverage === "incomplete" || coverage === "unknown" || coverage === "disabled" || metrics !== "statically-known";
}

/** The observation depends only on the reading, so rules that share a metric share it unchanged. */
function toObservation(
  artifact: AnalysisArtifactV1,
  reading: MetricReadingV1,
): { observation: BalanceObservationV1; estimated: EstimatedObservationV1 | null } {
  const unavailable = isUnavailable(reading);
  const unit = reading.domain !== "amount" ? reading.domain : (reading.amount?.unit ?? "amount");
  const identity = {
    metricId: reading.metricId,
    definition: reading.meaning,
    method: reading.method ?? "unspecified",
    scenarioVersion: "unspecified",
    specVersion: "unspecified",
    engineId: "unspecified",
    pluginVersion: "unspecified",
    seed: "unspecified",
    unit,
    algorithmVersion: artifact.algorithmVersion,
  };
  // Availability first: an unavailable reading is missing, censored, or unsupported by its status, whatever its domain.
  if (unavailable) {
    const status = reading.status === "unsupported" ? "unsupported" : reading.status === "censored" ? "censored" : "missing";
    return { observation: { identity, status, value: null, lower: null, upper: null }, estimated: null };
  }
  // An available amount, observed or estimated, is not narrowed to a number.
  if (reading.domain === "amount") {
    return {
      observation: { identity, status: "unsupported", value: null, lower: null, upper: null },
      estimated: null,
    };
  }
  if (reading.reading === "estimated") {
    return {
      observation: { identity, status: "missing", value: null, lower: null, upper: null },
      estimated: {
        metricId: reading.metricId,
        value: typeof reading.value === "number" && Number.isFinite(reading.value) ? reading.value : null,
        reason: reading.reason ?? null,
      },
    };
  }
  if (coverageWithheld(artifact)) {
    return { observation: { identity, status: "unknown", value: null, lower: null, upper: null }, estimated: null };
  }
  if (
    reading.reading === "observed" &&
    reading.status === "ok" &&
    typeof reading.value === "number" &&
    Number.isFinite(reading.value)
  ) {
    return {
      observation: {
        identity,
        status: "measured",
        value: reading.value,
        lower: reading.value,
        upper: reading.value,
      },
      estimated: null,
    };
  }
  return {
    observation: { identity, status: "missing", value: null, lower: null, upper: null },
    estimated: null,
  };
}

function fillTemplate(id: RecommendationId, metricId: string): Readonly<{ en: string; ko: string }> {
  const template = TEMPLATES[id];
  return {
    en: template.en.replaceAll("{metricId}", metricId),
    ko: template.ko.replaceAll("{metricId}", metricId),
  };
}

type BalanceResult = BalanceCheckReportV1["results"][number];

function outcomeFor(
  result: BalanceResult | undefined,
  estimated: boolean,
  rule: JudgeRuleV1,
): { recommendationId: RecommendationId; status: DiagnosticStatus; category: JudgeLayer; severity: "error" | "warn" | "info" } {
  const verdict = result?.verdict ?? "inconclusive";
  // A missing, absent, or withheld (unknown) reading is insufficient whatever its missing policy makes
  // the numerical verdict, and before any identity mismatch is considered.
  const noReading =
    !result ||
    result.evidence.status === "missing" ||
    result.evidence.status === "absent" ||
    result.evidence.status === "unknown";
  if (estimated) {
    return {
      recommendationId: "rec.metric.estimate-not-measured",
      status: "insufficient",
      category: "estimate",
      severity: "info",
    };
  }
  if (noReading) {
    return {
      recommendationId: "rec.metric.insufficient",
      status: "insufficient",
      category: "semantic",
      severity: "info",
    };
  }
  // A reading taken under another identity is not missing data; it is not comparable.
  if (result.mismatches.length > 0) {
    return {
      recommendationId: "rec.metric.identity-mismatch",
      status: "indeterminate",
      category: "semantic",
      severity: "info",
    };
  }
  if (verdict === "pass") {
    return {
      recommendationId: "rec.metric.within-threshold",
      status: "noted",
      category: "semantic",
      severity: "info",
    };
  }
  if (verdict === "fail") {
    // The rubric rule selects the recommendation for its own violation.
    return {
      recommendationId: rule.recommendationId,
      status: "conflict",
      category: "semantic",
      severity: "warn",
    };
  }
  if (verdict === "unsupported") {
    return {
      recommendationId: "rec.metric.unsupported",
      status: "unsupported",
      category: "semantic",
      severity: "info",
    };
  }
  return {
    recommendationId: "rec.metric.insufficient",
    status: "insufficient",
    category: "semantic",
    severity: "info",
  };
}

function checkFor(rule: JudgeRuleV1, method: string, unit: string): BalanceCheckV1 {
  return {
    id: rule.id,
    metricId: rule.metricId,
    operator: rule.operator,
    threshold: rule.threshold,
    upperThreshold: rule.upperThreshold,
    unit,
    severity: rule.severity,
    missingPolicy: rule.missingPolicy,
    definition: rule.definition,
    method,
    scenarioVersion: rule.scenarioVersion,
    specVersion: rule.specVersion,
    engineId: rule.engineId,
    pluginVersion: rule.pluginVersion,
    seed: rule.seed,
    algorithmVersion: rule.algorithmVersion,
  };
}

export function judgeArtifact(
  artifact: AnalysisArtifactV1,
  rubric: JudgeRubricV1,
): { ok: true; report: JudgeReportV1 } | { ok: false; issues: readonly string[] } {
  if (artifact.schemaVersion !== 1) return { ok: false, issues: ["artifact schemaVersion"] };
  if (artifact.algorithmVersion !== analysisAlgorithmVersion()) {
    return { ok: false, issues: ["artifact algorithmVersion"] };
  }
  if (rubric.rules.length === 0) return { ok: false, issues: ["rubric has no rules"] };
  // A structurally valid artifact can still break its cross-field contract; that artifact is not judged.
  const semantic = validateAnalysisSemantics(artifact);
  if (semantic.length > 0) {
    return { ok: false, issues: semantic.map((issue) => `artifact ${issue.path} ${issue.message}`) };
  }
  const issues: string[] = [];
  const observed = new Set<string>();
  const observations: BalanceObservationV1[] = [];
  const estimatedObservations: EstimatedObservationV1[] = [];
  const prepared: Array<{
    rule: JudgeRuleV1;
    reading: MetricReadingV1;
    observation: BalanceObservationV1;
    estimated: EstimatedObservationV1 | null;
    ref: string;
  }> = [];
  for (const rule of rubric.rules) {
    const readings = findReadings(artifact, rule.metricId);
    const reading = readings[0];
    if (!reading) {
      issues.push(`missing evidenceRef metric:${rule.metricId}`);
      continue;
    }
    // An evidence ref must name exactly one reading, so reading order cannot change a verdict.
    if (readings.length > 1) {
      issues.push(`ambiguous evidenceRef metric:${rule.metricId} matches ${readings.length} readings`);
      continue;
    }
    const mapped = toObservation(artifact, reading);
    // One observation per metric, so two rules on the same metric judge the same reading.
    if (!observed.has(reading.metricId)) {
      observed.add(reading.metricId);
      observations.push(mapped.observation);
      if (mapped.estimated) estimatedObservations.push(mapped.estimated);
    }
    prepared.push({
      rule,
      reading,
      observation: mapped.observation,
      estimated: mapped.estimated,
      ref: `metric:${rule.metricId}`,
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  /*
   * readMetric records a method only on an estimate, so observed and unavailable readings carry none,
   * and an unavailable amount carries no unit. Fields a reading does not record cannot disagree with
   * a rule, so each rule's own check takes them from the shared observation. A method the reading
   * does record must match. The observation is never rewritten per rule.
   */
  const checks: BalanceCheckV1[] = prepared.map(({ rule, reading, observation }) => {
    const unavailable = isUnavailable(reading);
    const method = reading.method === undefined ? observation.identity.method : rule.method;
    const unit =
      unavailable && reading.domain === "amount" && reading.amount === undefined ? observation.identity.unit : rule.unit;
    return checkFor(rule, method, unit);
  });
  const numerical = evaluateBalanceChecks({
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    failOn: rubric.failOn,
    checks,
    observations,
    advisory: null,
  });
  const assumptionRefs = artifact.assumptions.filter((item) => item.length > 0);
  const diagnostics: JudgeDiagnosticV1[] = prepared.map((item, index) => {
    const outcome = outcomeFor(numerical.results[index], item.estimated !== null, item.rule);
    return {
      id: item.rule.id,
      category: outcome.category,
      severity: outcome.severity,
      evidenceRefs: [item.ref],
      assumptionRefs,
      recommendationId: outcome.recommendationId,
      status: outcome.status,
      text: fillTemplate(outcome.recommendationId, item.rule.metricId),
    };
  });
  const advisoryDigest = `rules:${rubric.rubricVersion}:${diagnostics.map((item) => item.recommendationId).join(",")}`;
  const report: JudgeReportV1 = {
    schemaVersion: 1,
    contract: "idlekit.judge.v1",
    algorithmVersion: JUDGE_ALGORITHM_VERSION,
    provider: "rules",
    rubricVersion: rubric.rubricVersion,
    advisoryDigest,
    numerical,
    estimatedObservations,
    diagnostics,
    externalProvider: false,
    baselineRewrite: false,
  };
  return { ok: true, report };
}
