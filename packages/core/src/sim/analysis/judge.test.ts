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
  toObservation,
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
 * @evidenceReview ./judge.ts#judgeArtifact #c85ec46 Re-read the function, toObservation, checkFor, and evaluateGroups: it rejects a nonfinite threshold in a typed rubric, judges each observation group separately so a rule mismatches only against its own stand-ins in either rule order, and checks keep the rubric method and unit, the observation takes the rule's method when the reading records none and its unit when an unavailable amount records none, observations are shared per distinct identity, and it rejects a semantically invalid artifact and a metric id that matches two readings, maps each metric to one observation, the numerical block equals a direct evaluateBalanceChecks call for 3h, an observed or estimated amount reading is unsupported with no value and no estimate entry, and two rules on one metric both pass.
 * @evidence ./judge.ts#toObservation Maps a validated reading into the numerical judge's effective identity and availability.
 * @evidenceReview ./judge.ts#toObservation #4a4fe85 Re-read the mapper: a measured time reading has the rule method and unit, unspecified provenance fields, the artifact algorithm version, and the recorded value; amounts, estimates, and withheld coverage never provide a measured numerical point.
 */
export function reusesBalanceChecks(): void {
  expect(judgeCheckReuse).toBe("checks-not-recomputed");
  const measured = reading({ reading: "observed", status: "ok", value: 3 });
  expect(toObservation(artifact([measured]), measured, rule()).observation).toMatchObject({
    status: "measured", value: 3, identity: { method: "exact", unit: "time", engineId: "unspecified", algorithmVersion: analysisAlgorithmVersion() },
  });
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
  // Two rules on one metric judge the same reading once each, not an ambiguous pair.
  const twice = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]),
    rubric([rule(), rule({ id: "first-reset-floor", operator: "gte", threshold: 1 })]),
  );
  expect(twice.ok).toBe(true);
  if (!twice.ok) return;
  expect(twice.report.numerical.results.map((result) => result.verdict)).toEqual(["pass", "pass"]);
  // An estimated amount is an amount first: unsupported, not an estimate with a null value.
  const estimatedAmount = judgeArtifact(
    artifact([
      reading({
        reading: "estimated",
        status: "ok",
        domain: "amount",
        value: undefined,
        amount: { unit: "coin", decimal: "5" },
      }),
    ]),
    rubric([rule({ unit: "coin" })]),
  );
  expect(estimatedAmount.ok).toBe(true);
  if (!estimatedAmount.ok) return;
  expect(estimatedAmount.report.numerical.results[0]?.verdict).toBe("unsupported");
  expect(estimatedAmount.report.estimatedObservations).toEqual([]);
  expect(estimatedAmount.report.diagnostics[0]?.recommendationId).toBe("rec.metric.unsupported");
}

/**
 * @evidence docs/requirements/active/optional-analysis-judge.md#req-pr18-evidence-refs Bad versions and a missing metric id are rejected.
 * @evidenceReview docs/requirements/active/optional-analysis-judge.md#req-pr18-evidence-refs #a078dea Re-read the section, then ran this function: extra fields and missing refs fail.
 * @evidence ./judge.ts#judgeEvidenceRefs Reads the evidence-ref marker.
 * @evidenceReview ./judge.ts#judgeEvidenceRefs #ad623a2 The declaration is existing-refs-only.
 * @evidence ./judge.ts#parseJudgeRubric Validates a rubric before it is used.
 * @evidenceReview ./judge.ts#parseJudgeRubric #4eeb18f Re-read the function and nonfiniteThresholds: a complete rubric is accepted, a bad version, an unknown root or rule field, an empty rule list, and a nonfinite threshold or upper threshold are rejected.
 */
export function rejectsBadRefs(): void {
  expect(judgeEvidenceRefs).toBe("existing-refs-only");
  const badRubric = parseJudgeRubric({ ...rubric(), schemaVersion: 2, shell: "rm -rf /" });
  expect(badRubric.ok).toBe(false);
  expect(parseJudgeRubric(rubric()).ok).toBe(true);
  const empty = parseJudgeRubric(rubric([]));
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.issues).toEqual(["rubric has no rules"]);
  // Unknown fields are rejected at the rubric root and inside a rule.
  const extraRoot = parseJudgeRubric({ ...rubric(), notes: "typo" });
  expect(extraRoot.ok).toBe(false);
  if (!extraRoot.ok) expect(extraRoot.issues.join(" ")).toContain("notes");
  const extraRule = parseJudgeRubric(rubric([{ ...rule(), thresold: 3 } as JudgeRuleV1]));
  expect(extraRule.ok).toBe(false);
  if (!extraRule.ok) expect(extraRule.issues.join(" ")).toContain("thresold");
  // A nonfinite threshold (JSON 1e400 parses as Infinity) is rejected, not compared or serialized as null.
  const infinite = parseJudgeRubric(JSON.parse(JSON.stringify(rubric()).replace('"threshold":2', '"threshold":1e400')));
  expect(infinite.ok).toBe(false);
  if (!infinite.ok) expect(infinite.issues).toEqual(["$input.rules[0].threshold finite number"]);
  const infiniteUpper = parseJudgeRubric(rubric([rule({ operator: "between", threshold: 1, upperThreshold: Infinity })]));
  expect(infiniteUpper.ok).toBe(false);
  // The public judgeArtifact applies the same check to a typed rubric that skipped the parser.
  const directInfinite = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]),
    rubric([rule({ threshold: Infinity })]),
  );
  expect(directInfinite.ok).toBe(false);
  if (!directInfinite.ok) expect(directInfinite.issues).toEqual(["$input.rules[0].threshold finite number"]);
  // A structurally valid artifact that breaks its semantic contract is not judged.
  const twoRepresentations = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1, amount: { unit: "coin", decimal: "1" } })]),
    rubric(),
  );
  expect(twoRepresentations.ok).toBe(false);
  if (!twoRepresentations.ok) {
    expect(twoRepresentations.issues).toContain("artifact metrics.0 numeric reading carries an amount");
  }
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
  // Two readings with one metric id make the evidence ref ambiguous, whatever their order.
  const duplicate = judgeArtifact(
    artifact([
      reading({ reading: "observed", status: "ok", value: 1.5 }),
      reading({ reading: "observed", status: "ok", value: 3 }),
    ]),
    rubric(),
  );
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.issues).toEqual(["ambiguous evidenceRef metric:first-reset matches 2 readings"]);
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
  // The rubric rule's recommendationId selects the template for its own violation.
  const chosen = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 3 })]),
    rubric([rule({ recommendationId: "rec.metric.unsupported" })]),
  );
  expect(chosen.ok).toBe(true);
  if (!chosen.ok) return;
  expect(chosen.report.diagnostics[0]?.status).toBe("conflict");
  expect(chosen.report.diagnostics[0]?.recommendationId).toBe("rec.metric.unsupported");
  expect(chosen.report.diagnostics[0]?.text.en).toBe("Metric first-reset cannot be compared by the rules provider.");
  expect(chosen.report.advisoryDigest).toBe("rules:rubric-18:rec.metric.unsupported");
  expect(chosen.report.numerical).toEqual(judged.report.numerical);
  // A measured reading under another method is indeterminate, not "no measured value".
  const otherMethod = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5, method: "monte-carlo" })]),
    rubric(),
  );
  expect(otherMethod.ok).toBe(true);
  if (!otherMethod.ok) return;
  expect(otherMethod.report.numerical.results[0]?.verdict).toBe("inconclusive");
  expect(otherMethod.report.numerical.results[0]?.mismatches).toEqual(["method"]);
  expect(otherMethod.report.diagnostics[0]?.status).toBe("indeterminate");
  expect(otherMethod.report.diagnostics[0]?.recommendationId).toBe("rec.metric.identity-mismatch");
  expect(otherMethod.report.diagnostics[0]?.text.en).not.toContain("no measured value");
  expect(validateJudgeReport(otherMethod.report).success).toBe(true);
  // readMetric omits method on an observed reading; the rule's method does not turn it into a mismatch.
  const generatedObserved = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5, method: undefined })]),
    rubric(),
  );
  expect(generatedObserved.ok).toBe(true);
  if (!generatedObserved.ok) return;
  expect(generatedObserved.report.numerical.results[0]?.verdict).toBe("pass");
  expect(generatedObserved.report.numerical.results[0]?.mismatches).toEqual([]);
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
  // missingPolicy fail fails the numerical gate, but a missing reading is still insufficient, not a conflict.
  const failMissing = judgeArtifact(
    artifact([reading({ reading: "unavailable", status: "insufficient-data" })], { observationCoverage: "incomplete" }),
    rubric([rule({ missingPolicy: "fail" })]),
  );
  expect(failMissing.ok).toBe(true);
  if (!failMissing.ok) return;
  expect(failMissing.report.numerical.results[0]?.verdict).toBe("fail");
  expect(failMissing.report.numerical.pass).toBe(false);
  expect(failMissing.report.diagnostics[0]?.status).toBe("insufficient");
  expect(failMissing.report.diagnostics[0]?.recommendationId).toBe("rec.metric.insufficient");
  // A generated unavailable reading omits method (and an amount omits its unit). The missing policy
  // still decides the numerical verdict instead of an identity mismatch.
  const generated = judgeArtifact(
    artifact([reading({ reading: "unavailable", status: "insufficient-data", method: undefined })], {
      observationCoverage: "incomplete",
    }),
    rubric([rule({ missingPolicy: "fail" })]),
  );
  expect(generated.ok).toBe(true);
  if (!generated.ok) return;
  expect(generated.report.numerical.results[0]?.verdict).toBe("fail");
  expect(generated.report.numerical.results[0]?.mismatches).toEqual([]);
  expect(generated.report.diagnostics[0]?.status).toBe("insufficient");
  const unavailableAmount = judgeArtifact(
    artifact(
      [reading({ reading: "unavailable", status: "unknown", domain: "amount", method: undefined, value: undefined })],
      { observationCoverage: "incomplete" },
    ),
    rubric([rule({ unit: "coin", missingPolicy: "fail" })]),
  );
  expect(unavailableAmount.ok).toBe(true);
  if (!unavailableAmount.ok) return;
  expect(unavailableAmount.report.numerical.results[0]?.verdict).toBe("fail");
  expect(unavailableAmount.report.numerical.results[0]?.evidence.status).toBe("missing");
  expect(unavailableAmount.report.diagnostics[0]?.status).toBe("insufficient");
  expect(unavailableAmount.report.diagnostics[0]?.recommendationId).toBe("rec.metric.insufficient");
  // Rules that share one unavailable reading each apply their own missing policy, whatever method
  // or amount unit they name.
  const shared = judgeArtifact(
    artifact([reading({ reading: "unavailable", status: "insufficient-data", method: undefined })], {
      observationCoverage: "incomplete",
    }),
    rubric([
      rule({ missingPolicy: "fail" }),
      rule({ id: "first-reset-mc", method: "monte-carlo", missingPolicy: "fail" }),
    ]),
  );
  expect(shared.ok).toBe(true);
  if (!shared.ok) return;
  expect(shared.report.numerical.results.map((result) => result.verdict)).toEqual(["fail", "fail"]);
  expect(shared.report.numerical.results.map((result) => result.mismatches)).toEqual([[], []]);
  const sharedAmount = judgeArtifact(
    artifact(
      [reading({ reading: "unavailable", status: "unknown", domain: "amount", method: undefined, value: undefined })],
      { observationCoverage: "incomplete" },
    ),
    rubric([
      rule({ unit: "coin", missingPolicy: "fail" }),
      rule({ id: "first-reset-gem", unit: "gem", missingPolicy: "fail" }),
    ]),
  );
  expect(sharedAmount.ok).toBe(true);
  if (!sharedAmount.ok) return;
  expect(sharedAmount.report.numerical.results.map((result) => result.verdict)).toEqual(["fail", "fail"]);
  // The rubric unit stays in the numerical evidence, so coin and gem rules stay distinguishable.
  expect(sharedAmount.report.numerical.results.map((result) => result.evidence.unit)).toEqual(["coin", "gem"]);
  // An unavailable reading whose status is unsupported has no value: missing evidence, decided by the
  // missing policy and advised as insufficient.
  const unsupportedUnavailable = judgeArtifact(
    artifact([reading({ reading: "unavailable", status: "unsupported", method: undefined })], {
      observationCoverage: "incomplete",
    }),
    rubric([rule({ missingPolicy: "fail" })]),
  );
  expect(unsupportedUnavailable.ok).toBe(true);
  if (!unsupportedUnavailable.ok) return;
  expect(unsupportedUnavailable.report.numerical.results[0]?.verdict).toBe("fail");
  expect(unsupportedUnavailable.report.numerical.results[0]?.evidence.status).toBe("missing");
  expect(unsupportedUnavailable.report.diagnostics[0]?.status).toBe("insufficient");
  // A censored unavailable reading has no bounds either, so its missing policy applies.
  const censoredUnavailable = judgeArtifact(
    artifact([reading({ reading: "unavailable", status: "censored", method: undefined })], {
      observationCoverage: "incomplete",
    }),
    rubric([rule({ missingPolicy: "fail" })]),
  );
  expect(censoredUnavailable.ok && censoredUnavailable.report.numerical.results[0]?.verdict).toBe("fail");
  // A numeric reading records no unit, so a rule in hours compares the measured value.
  const hours = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5, method: undefined })]),
    rubric([rule({ unit: "h" })]),
  );
  expect(hours.ok).toBe(true);
  if (!hours.ok) return;
  expect(hours.report.numerical.results[0]?.verdict).toBe("pass");
  expect(hours.report.numerical.results[0]?.evidence.unit).toBe("h");
  // A rule that matches no observation reports its mismatch against its own stand-ins, whatever the
  // rule order: a later monte-carlo/s rule mismatches on method only, never on a unit the reading lacks.
  const exactHours = rule({ id: "exact-h", unit: "h" });
  const carloSeconds = rule({ id: "carlo-s", unit: "s", method: "monte-carlo" });
  for (const rules of [
    [exactHours, carloSeconds],
    [carloSeconds, exactHours],
  ]) {
    const judged = judgeArtifact(artifact([reading({ reading: "observed", status: "ok", value: 1.5 })]), rubric(rules));
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    const byId = new Map(judged.report.numerical.results.map((result) => [result.id, result]));
    expect(byId.get("exact-h")?.verdict).toBe("pass");
    expect(byId.get("carlo-s")?.mismatches).toEqual(["method"]);
    expect(judged.report.numerical.pass).toBe(false);
    expect(judged.report.numerical.exitCode).toBe(2);
    expect(judged.report.numerical.results.map((result) => result.id)).toEqual(rules.map((item) => item.id));
  }
  // An observed value under an unknown metrics capability or incomplete coverage is not measured.
  const unknownCapability = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })], {
      capabilities: {
        metrics: "unknown",
        goals: "statically-known",
        reset: "statically-known",
        flow: "statically-known",
        advance: "statically-known",
      },
    }),
    rubric(),
  );
  expect(unknownCapability.ok).toBe(true);
  if (!unknownCapability.ok) return;
  expect(unknownCapability.report.numerical.results[0]?.verdict).toBe("inconclusive");
  expect(unknownCapability.report.numerical.results[0]?.evidence.status).toBe("unknown");
  expect(unknownCapability.report.numerical.pass).toBe(false);
  expect(unknownCapability.report.diagnostics[0]?.status).toBe("insufficient");
  const incomplete = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })], { observationCoverage: "incomplete" }),
    rubric(),
  );
  expect(incomplete.ok).toBe(true);
  if (!incomplete.ok) return;
  expect(incomplete.report.numerical.results[0]?.verdict).toBe("inconclusive");
  expect(incomplete.report.diagnostics[0]?.status).toBe("insufficient");
  // Withheld coverage is insufficient even when the reading also differs from the rule's identity.
  const withheldMismatch = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5, meaning: "other-meaning" })], {
      observationCoverage: "unknown",
    }),
    rubric(),
  );
  expect(withheldMismatch.ok).toBe(true);
  if (!withheldMismatch.ok) return;
  expect(withheldMismatch.report.numerical.results[0]?.mismatches).toEqual(["definition"]);
  expect(withheldMismatch.report.diagnostics[0]?.status).toBe("insufficient");
  expect(withheldMismatch.report.diagnostics[0]?.recommendationId).toBe("rec.metric.insufficient");
  const partial = judgeArtifact(
    artifact([reading({ reading: "observed", status: "ok", value: 1.5 })], { observationCoverage: "partial" }),
    rubric(),
  );
  expect(partial.ok && partial.report.numerical.results[0]?.verdict).toBe("pass");
}

describe("optional analysis judge", () => {
  it("accepts a rules provider", acceptsRulesProvider);
  it("reuses balance checks", reusesBalanceChecks);
  it("rejects a missing evidence ref", rejectsBadRefs);
  it("separates report layers", separatesReportLayers);
  it("withholds a health label", withholdsHealthLabels);
});
