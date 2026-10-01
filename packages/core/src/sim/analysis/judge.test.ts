import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { evaluateBalanceChecks } from "./checks";
import { analysisAlgorithmVersion, type AnalysisArtifactV1, type MetricReadingV1 } from "./contracts";
import {
  judgeAlgorithmVersion,
  judgeArtifact,
  judgeCheckReuse,
  judgeEvidenceRefs,
  judgeInsufficient,
  judgeJsonSchema,
  judgeRulesProvider,
  judgeSchemaId,
  judgeSeparatedReport,
  parseJudgeRubric,
  validateJudgeReport,
  type JudgeRubricV1,
  type JudgeRuleV1,
} from "./judge";

const SEED = "18";

function reading(patch: Partial<MetricReadingV1> & Pick<MetricReadingV1, "reading" | "status">): MetricReadingV1 {
  return {
    metricId: "first-reset",
    metricVersion: 1,
    meaning: "first-reset-hours",
    metricKind: "stock",
    timeAxis: "instant",
    domain: "time",
    method: "exact",
    ...patch,
  };
}

function artifact(metrics: readonly MetricReadingV1[], patch: Partial<AnalysisArtifactV1> = {}): AnalysisArtifactV1 {
  return {
    schemaVersion: 1,
    algorithmVersion: analysisAlgorithmVersion(),
    assumptions: [`seed-${SEED}`],
    warnings: [],
    observationCoverage: "complete",
    metrics,
    goals: [],
    capabilities: {
      metrics: "statically-known",
      goals: "statically-known",
      reset: "statically-known",
      flow: "statically-known",
      advance: "statically-known",
    },
    ...patch,
  };
}

function rule(patch: Partial<JudgeRuleV1> = {}): JudgeRuleV1 {
  return {
    id: "first-reset",
    metricId: "first-reset",
    operator: "lte",
    threshold: 2,
    upperThreshold: null,
    unit: "time",
    severity: "error",
    missingPolicy: "inconclusive",
    definition: "first-reset-hours",
    method: "exact",
    scenarioVersion: null,
    specVersion: null,
    engineId: null,
    pluginVersion: null,
    seed: null,
    algorithmVersion: null,
    recommendationId: "rec.metric.outside-threshold",
    ...patch,
  };
}

function rubric(rules: readonly JudgeRuleV1[] = [rule()]): JudgeRubricV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.judge.rubric.v1",
    rubricVersion: "rubric-18",
    failOn: ["error"],
    rules,
  };
}

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider A rules report validates and does not fetch.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-rules-provider #bb58b8a Re-read the section, then ran this function: provider is rules and the digest repeats.
 * @evidence ./judge.ts#judgeRulesProvider Reads the rules provider marker.
 * @evidenceReview ./judge.ts#judgeRulesProvider #46b8abd The declaration is rules-not-vendor.
 * @evidence ./judge.ts#validateJudgeReport Reads the published validator.
 * @evidenceReview ./judge.ts#validateJudgeReport #dfb582a The validator is createValidate of JudgeReportV1, built on first call, and accepts the rules report.
 * @evidence ./judge.ts#judgeJsonSchema Reads the generated schema marker.
 * @evidenceReview ./judge.ts#judgeJsonSchema #4af4538 The memoized schema version is 3.1.
 * @evidence ./judge.ts#judgeSchemaId Reads the schema id.
 * @evidenceReview ./judge.ts#judgeSchemaId #7dca845 The id is the judge output schema URL.
 * @evidence ./judge.ts#judgeAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ./judge.ts#judgeAlgorithmVersion #ff62f23 The version is judge-rules-1 and the report carries it.
 */
export function acceptsRulesProvider(): void {
  expect(judgeRulesProvider).toBe("rules-not-vendor");
  expect(judgeJsonSchema().version).toBe("3.1");
  expect(judgeSchemaId()).toBe("https://idlekit.dev/schemas/judge.output.schema.json");
  const calls: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(input);
    throw new Error("fetch");
  }) as unknown as typeof fetch;
  try {
    const judged = judgeArtifact(
      artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]),
      rubric(),
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.report.provider).toBe("rules");
    expect(judged.report.externalProvider).toBe(false);
    expect(judged.report.contract).toBe("idlekit.judge.v1");
    expect(judged.report.rubricVersion).toBe("rubric-18");
    expect(judged.report.algorithmVersion).toBe(judgeAlgorithmVersion());
    const again = judgeArtifact(
      artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]),
      rubric(),
    );
    expect(again.ok && again.report.advisoryDigest).toBe(judged.report.advisoryDigest);
    expect(validateJudgeReport(judged.report).success).toBe(true);
    expect(calls).toEqual([]);
    const source = readFileSync(new URL("./judge.ts", import.meta.url), "utf8");
    expect(source.includes("new Function")).toBe(false);
    expect(source.includes("child_process")).toBe(false);
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-check-reuse The 1.5h and 3h readings use the balance-check engine.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-check-reuse #33488b3 Re-read the section, then ran this function: 1.5h passes and 3h fails.
 * @evidence ./judge.ts#judgeCheckReuse Reads the check-reuse marker.
 * @evidenceReview ./judge.ts#judgeCheckReuse #6aa2e90 The declaration is checks-not-recomputed.
 * @evidence ./judge.ts#judgeArtifact Maps artifact readings into balance checks and builds the report.
 * @evidenceReview ./judge.ts#judgeArtifact #2aafd76 The numerical block equals a direct evaluateBalanceChecks call for 3h, and an amount reading is unsupported with no value.
 */
export function reusesBalanceChecks(): void {
  expect(judgeCheckReuse).toBe("checks-not-recomputed");
  const pass = judgeArtifact(artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]), rubric());
  expect(pass.ok).toBe(true);
  if (!pass.ok) return;
  expect(pass.report.numerical.results[0]?.verdict).toBe("pass");
  expect(pass.report.numerical.pass).toBe(true);
  const fail = judgeArtifact(artifact([reading({ reading: "observed", status: "ok", value: 3 })]), rubric());
  expect(fail.ok).toBe(true);
  if (!fail.ok) return;
  const direct = evaluateBalanceChecks({
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    failOn: ["error"],
    advisory: null,
    checks: [
      {
        id: "first-reset",
        metricId: "first-reset",
        operator: "lte",
        threshold: 2,
        upperThreshold: null,
        unit: "time",
        severity: "error",
        missingPolicy: "inconclusive",
        definition: "first-reset-hours",
        method: "exact",
        scenarioVersion: null,
        specVersion: null,
        engineId: null,
        pluginVersion: null,
        seed: null,
        algorithmVersion: null,
      },
    ],
    observations: [
      {
        identity: {
          metricId: "first-reset",
          definition: "first-reset-hours",
          method: "exact",
          scenarioVersion: "unspecified",
          specVersion: "unspecified",
          engineId: "unspecified",
          pluginVersion: "unspecified",
          seed: "unspecified",
          unit: "time",
          algorithmVersion: analysisAlgorithmVersion(),
        },
        status: "measured",
        value: 3,
        lower: 3,
        upper: 3,
      },
    ],
  });
  expect(fail.report.numerical).toEqual(direct);
  const amount = judgeArtifact(
    artifact([
      reading({
        reading: "observed",
        status: "ok",
        domain: "amount",
        value: undefined,
        amount: { unit: "coin", decimal: "100000000000000000000" },
      }),
    ]),
    rubric([rule({ unit: "coin", definition: "first-reset-hours" })]),
  );
  expect(amount.ok).toBe(true);
  if (!amount.ok) return;
  expect(amount.report.numerical.results[0]?.verdict).toBe("unsupported");
  expect(amount.report.numerical.results[0]?.evidence.value).toBeNull();
}

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-evidence-refs Bad versions and a missing metric id are rejected.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-evidence-refs #a078dea Re-read the section, then ran this function: extra fields and missing refs fail.
 * @evidence ./judge.ts#judgeEvidenceRefs Reads the evidence-ref marker.
 * @evidenceReview ./judge.ts#judgeEvidenceRefs #ad623a2 The declaration is existing-refs-only.
 * @evidence ./judge.ts#parseJudgeRubric Validates a rubric before it is used.
 * @evidenceReview ./judge.ts#parseJudgeRubric #b0cc620 A complete rubric is accepted, a bad version is rejected, and an empty rule list is rejected.
 */
export function rejectsBadRefs(): void {
  expect(judgeEvidenceRefs).toBe("existing-refs-only");
  const badRubric = parseJudgeRubric({ ...rubric(), schemaVersion: 2, shell: "rm -rf /" });
  expect(badRubric.ok).toBe(false);
  expect(parseJudgeRubric(rubric()).ok).toBe(true);
  const empty = parseJudgeRubric(rubric([]));
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.issues).toEqual(["rubric has no rules"]);
  const badAlgorithm = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })], { algorithmVersion: "other" }),
    rubric(),
  );
  expect(badAlgorithm.ok).toBe(false);
  const missing = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]),
    rubric([rule({ metricId: "absent-metric" })]),
  );
  expect(missing.ok).toBe(false);
  if (missing.ok) return;
  expect(missing.issues.join(" ")).toContain("missing evidenceRef metric:absent-metric");
}

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-separated-report A conflict stays advisory and the numerical fail stays fail.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-separated-report #0fb3aa6 Re-read the section, then ran this function: status is conflict and baselineRewrite is false.
 * @evidence ./judge.ts#judgeSeparatedReport Reads the separated-report marker.
 * @evidenceReview ./judge.ts#judgeSeparatedReport #bc1402e The declaration is layers-stay-apart.
 */
export function separatesReportLayers(): void {
  expect(judgeSeparatedReport).toBe("layers-stay-apart");
  const judged = judgeArtifact(artifact([reading({ reading: "observed", status: "ok", value: 3 })]), rubric());
  expect(judged.ok).toBe(true);
  if (!judged.ok) return;
  expect(judged.report.numerical.results[0]?.verdict).toBe("fail");
  expect(judged.report.numerical.exitCode).toBe(2);
  expect(judged.report.baselineRewrite).toBe(false);
  expect(judged.report.estimatedObservations).toEqual([]);
  expect(judged.report.diagnostics[0]?.category).toBe("semantic");
  expect(judged.report.diagnostics[0]?.status).toBe("conflict");
  expect(judged.report.diagnostics[0]?.recommendationId).toBe("rec.metric.outside-threshold");
  expect(judged.report.diagnostics[0]?.text.en).toContain("first-reset");
  expect(judged.report.diagnostics[0]?.text.ko).toContain("first-reset");
  expect(judged.report.diagnostics[0]?.assumptionRefs).toEqual([`seed-${SEED}`]);
  expect(judged.report.advisoryDigest).toBe("rules:rubric-18:rec.metric.outside-threshold");
}

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-insufficient An unknown model and an estimate do not become a measured pass.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-insufficient #ed2626d Re-read the section, then ran this function: status is insufficient.
 * @evidence ./judge.ts#judgeInsufficient Reads the insufficient marker.
 * @evidenceReview ./judge.ts#judgeInsufficient #2ed649d The declaration is not-a-health-label.
 */
export function withholdsHealthLabels(): void {
  expect(judgeInsufficient).toBe("not-a-health-label");
  const missing = judgeArtifact(
    artifact([reading({ reading: "unavailable", status: "insufficient-data" })], {
      observationCoverage: "incomplete",
      capabilities: {
        metrics: "unknown",
        goals: "unknown",
        reset: "unknown",
        flow: "unknown",
        advance: "unknown",
      },
    }),
    rubric(),
  );
  expect(missing.ok).toBe(true);
  if (!missing.ok) return;
  expect(missing.report.numerical.results[0]?.verdict).toBe("inconclusive");
  expect(missing.report.diagnostics[0]?.status).toBe("insufficient");
  expect(JSON.stringify(missing.report).includes("balanced")).toBe(false);
  expect(JSON.stringify(missing.report).includes("healthy")).toBe(false);
  const estimated = judgeArtifact(
    artifact([reading({ reading: "estimated", status: "ok", value: 1.5 })]),
    rubric(),
  );
  expect(estimated.ok).toBe(true);
  if (!estimated.ok) return;
  expect(estimated.report.numerical.pass).toBe(false);
  expect(estimated.report.estimatedObservations).toEqual([{ metricId: "first-reset", value: 1.5, reason: null }]);
  expect(estimated.report.diagnostics[0]?.category).toBe("estimate");
  expect(estimated.report.diagnostics[0]?.status).toBe("insufficient");
}

describe("optional analysis judge", () => {
  it("accepts a rules provider", acceptsRulesProvider);
  it("reuses balance checks", reusesBalanceChecks);
  it("rejects a missing evidence ref", rejectsBadRefs);
  it("separates report layers", separatesReportLayers);
  it("withholds a health label", withholdsHealthLabels);
});
