import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import {
  adaptKpiRegression,
  balanceAssertionGrammar,
  balanceCheckSpec,
  balanceChecksAlgorithmVersion,
  balanceChecksJsonSchema,
  balanceChecksSchemaId,
  balanceFailureReport,
  balanceIdentityMismatch,
  balanceKpiAdapter,
  balanceNumericAdvisory,
  balanceVerdictBounds,
  classifyAssertionExpr,
  evaluateBalanceChecks,
  parseBalanceCheckRequest,
  parseFailOn,
  renderBalanceCheckMarkdown,
  toBalanceCheckError,
  validateBalanceCheckReport,
  type BalanceCheckRequestV1,
  type BalanceCheckV1,
  type BalanceIdentityV1,
  type BalanceObservationV1,
  type CheckOperator,
  type ObservationStatus,
} from "./checks";

const SEED = "17";

function identity(metricId: string, patch: Partial<BalanceIdentityV1> = {}): BalanceIdentityV1 {
  return {
    metricId,
    definition: "design-threshold",
    method: "observation",
    scenarioVersion: "scenario-v1",
    specVersion: "checks-v1",
    engineId: "number",
    pluginVersion: "none",
    seed: SEED,
    unit: "h",
    algorithmVersion: "1",
    ...patch,
  };
}

function check(patch: Partial<BalanceCheckV1> & Pick<BalanceCheckV1, "id" | "metricId" | "operator" | "threshold">): BalanceCheckV1 {
  return {
    upperThreshold: null,
    unit: "h",
    severity: "error",
    missingPolicy: "inconclusive",
    definition: "design-threshold",
    method: "observation",
    scenarioVersion: "scenario-v1",
    specVersion: "checks-v1",
    engineId: "number",
    pluginVersion: "none",
    seed: SEED,
    algorithmVersion: "1",
    ...patch,
  };
}

function observation(
  metricId: string,
  status: ObservationStatus,
  value: number | null,
  lower: number | null,
  upper: number | null,
  patch: Partial<BalanceIdentityV1> = {},
): BalanceObservationV1 {
  return { identity: identity(metricId, patch), status, value, lower, upper };
}

function request(checks: readonly BalanceCheckV1[], observations: readonly BalanceObservationV1[], advisory: string | null = null): BalanceCheckRequestV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    failOn: ["error"],
    checks,
    observations,
    advisory,
  };
}

function verdictOf(checks: readonly BalanceCheckV1[], observations: readonly BalanceObservationV1[]) {
  const report = evaluateBalanceChecks(request(checks, observations));
  return report.results[0];
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-check-spec A registered check keeps the metric, operator, threshold, unit, severity, and missing policy.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-check-spec #d7f7211 Re-read the section, then ran this function: first-reset uses lte, 2, h, error, and inconclusive.
 * @evidence ./checks.ts#balanceCheckSpec Reads the registered spec marker.
 * @evidenceReview ./checks.ts#balanceCheckSpec #7a7011f The declaration is registered-check-spec.
 * @evidence ./checks.ts#parseFailOn Parses the fail-on list.
 * @evidenceReview ./checks.ts#parseFailOn #0fc31f0 error,warn keeps both tokens and an unknown token returns null.
 * @evidence ./checks.ts#parseBalanceCheckRequest Validates a check file before it is judged.
 * @evidenceReview ./checks.ts#parseBalanceCheckRequest #9c2e26c A complete request is accepted and a request without checks reports a path.
 */
export function checksRegisteredMetrics(): void {
  expect(balanceCheckSpec).toBe("registered-check-spec");
  const spec = check({ id: "first-reset", metricId: "first-reset", operator: "lte", threshold: 2, unit: "h" });
  expect(spec.severity).toBe("error");
  expect(spec.missingPolicy).toBe("inconclusive");
  const source = readFileSync(new URL("./checks.ts", import.meta.url), "utf8");
  expect(source.includes("new Function")).toBe(false);
  expect(parseFailOn("error,warn")?.join(",")).toBe("error,warn");
  expect(parseFailOn("javascript")).toBeNull();
  expect(parseFailOn(" , ")).toBeNull();
  const parsed = parseBalanceCheckRequest(request([spec], [observation("first-reset", "measured", 1, 1, 1)]));
  expect(parsed.ok).toBe(true);
  const rejected = parseBalanceCheckRequest({ schemaVersion: 1, contract: "idlekit.balance-checks.v1" });
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) expect(rejected.issues.some((issue) => issue.includes("checks"))).toBe(true);
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-verdict-bounds Measured hours, an unknown p95, a censored lower bound, and an action range stay distinct.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-verdict-bounds #7c48cdf Re-read the section, then ran this function: 1.5h passes, 3h fails, unknown does not pass, and lower 9h fails.
 * @evidence ./checks.ts#balanceVerdictBounds Reads the bound marker.
 * @evidenceReview ./checks.ts#balanceVerdictBounds #23347e0 The declaration is bounds-not-zero.
 * @evidence ./checks.ts#evaluateBalanceChecks Judges each check against its observation.
 * @evidenceReview ./checks.ts#evaluateBalanceChecks #3d9f537 A measured point, an unknown, a censored lower bound, a missing value, an absent metric, a between range, and an unsupported metric each get their own verdict.
 */
export function judgesBoundedMetrics(): void {
  expect(balanceVerdictBounds).toBe("bounds-not-zero");
  const first = check({ id: "first-reset", metricId: "first-reset", operator: "lte" as CheckOperator, threshold: 2 });
  expect(verdictOf([first], [observation("first-reset", "measured", 1.5, 1.5, 1.5)])?.verdict).toBe("pass");
  expect(verdictOf([first], [observation("first-reset", "measured", 3, 3, 3)])?.verdict).toBe("fail");
  const goal = check({ id: "p95-goal", metricId: "p95-goal", operator: "lte", threshold: 8 });
  const unknown = verdictOf([goal], [observation("p95-goal", "unknown", null, null, null)]);
  expect(unknown?.verdict).toBe("inconclusive");
  expect(unknown?.verdict).not.toBe("pass");
  const censored = verdictOf([goal], [observation("p95-goal", "censored", null, 9, null)]);
  expect(censored?.verdict).toBe("fail");
  expect(censored?.evidence.lower).toBe(9);
  const missing = verdictOf([goal], [observation("p95-goal", "missing", 0, 0, 0)]);
  expect(missing?.verdict).toBe("inconclusive");
  expect(missing?.evidence.value).toBeNull();
  const absent = verdictOf([goal], []);
  expect(absent?.verdict).not.toBe("pass");
  const actions = check({
    id: "actions",
    metricId: "active-actions-per-minute",
    operator: "between",
    threshold: 1,
    upperThreshold: 5,
    unit: "1/min",
  });
  expect(verdictOf([actions], [observation("active-actions-per-minute", "measured", 3, 3, 3, { unit: "1/min" })])?.verdict).toBe("pass");
  expect(verdictOf([actions], [observation("active-actions-per-minute", "measured", 0, 0, 0, { unit: "1/min" })])?.verdict).toBe("fail");
  expect(verdictOf([actions], [observation("active-actions-per-minute", "measured", 9, 9, 9, { unit: "1/min" })])?.verdict).toBe("fail");
  const unsupported = verdictOf([goal], [observation("p95-goal", "unsupported", 1, 1, 1)]);
  expect(unsupported?.verdict).toBe("unsupported");
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-identity-mismatch Unit, engine, and algorithm mismatches stay inconclusive and do not rewrite a baseline.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-identity-mismatch #b9af2a2 Re-read the section, then ran this function: h versus s, number versus breakInfinity, and algorithm 1 versus 2 are mismatches.
 * @evidence ./checks.ts#balanceIdentityMismatch Reads the mismatch marker.
 * @evidenceReview ./checks.ts#balanceIdentityMismatch #a06d3a1 The declaration is mismatch-not-rewritten.
 */
export function reportsIdentityMismatch(): void {
  expect(balanceIdentityMismatch).toBe("mismatch-not-rewritten");
  const spec = check({ id: "goal", metricId: "p95-goal", operator: "lte", threshold: 8 });
  const unit = verdictOf([spec], [observation("p95-goal", "measured", 1, 1, 1, { unit: "s" })]);
  expect(unit?.verdict).toBe("inconclusive");
  expect(unit?.mismatches).toContain("unit");
  const engine = verdictOf([spec], [observation("p95-goal", "measured", 1, 1, 1, { engineId: "breakInfinity" })]);
  expect(engine?.mismatches).toContain("engineId");
  expect(engine?.verdict).toBe("inconclusive");
  const algorithm = verdictOf([spec], [observation("p95-goal", "measured", 1, 1, 1, { algorithmVersion: "2" })]);
  expect(algorithm?.mismatches).toContain("algorithmVersion");
  expect(algorithm?.verdict).toBe("inconclusive");
  const report = evaluateBalanceChecks(request([spec], [observation("p95-goal", "measured", 1, 1, 1, { unit: "s" })]));
  expect(report.baselineRewrite).toBe(false);
  expect(report.pass).toBe(false);
}

function kpiReport(worth: string) {
  const horizon = {
    endNetWorth: worth,
    guardrails: { stallRatio: 0.1, droppedRate: 0.02 },
  };
  const side = { summary: { at7d: horizon, at30d: horizon, at90d: horizon }, perceived: { visibleChangesPerMinute: 4, maxNoRewardGapSec: 30 } };
  return { ltv: { a: side, b: side }, experience: { a: side, b: side } };
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-kpi-adapter Identical worth 100 passes and worth 1 fails through the shared engine.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-kpi-adapter #9f228f6 Re-read the section, then ran this function: the adapter pass bit follows the engine and a zero visible baseline does not collapse the ratio.
 * @evidence ./checks.ts#balanceKpiAdapter Reads the adapter marker.
 * @evidenceReview ./checks.ts#balanceKpiAdapter #e40f7e2 The declaration is kpi-adapter.
 * @evidence ./checks.ts#adaptKpiRegression Maps the a/b horizon report into balance checks.
 * @evidenceReview ./checks.ts#adaptKpiRegression #e097cf5 Identical reports pass, worth 1 against 100 fails the worth bit, and a missing visible rate on both sides keeps the ratio at 1.
 */
export function adaptsKpiRegression(): void {
  expect(balanceKpiAdapter).toBe("kpi-adapter");
  const same = adaptKpiRegression({
    baseline: kpiReport("100"),
    current: kpiReport("100"),
    baselinePath: "baseline.json",
    currentPath: "current.json",
    generatedAt: "2026-10-02T00:00:00.000Z",
    minWorthRatio: 0.97,
    maxStallDelta: 0.03,
    maxDroppedDelta: 0.03,
    minVisibleProgressRatio: 0.9,
    maxNoRewardGapDelta: 60,
  });
  expect(same.pass).toBe(true);
  expect(same.balanceChecks.externalProvider).toBe(false);
  expect(same.checks).toHaveLength(6);
  const dropped = adaptKpiRegression({
    baseline: kpiReport("100"),
    current: kpiReport("1"),
    baselinePath: "baseline.json",
    currentPath: "current.json",
    generatedAt: "2026-10-02T00:00:00.000Z",
    minWorthRatio: 0.97,
    maxStallDelta: 0.03,
    maxDroppedDelta: 0.03,
    minVisibleProgressRatio: 0.9,
    maxNoRewardGapDelta: 60,
  });
  expect(dropped.pass).toBe(false);
  expect(dropped.checks.every((row) => row.pass.worth)).toBe(false);
  const hidden = kpiReport("100");
  (hidden.experience.a.perceived as { visibleChangesPerMinute?: number }).visibleChangesPerMinute = undefined;
  const legacy = adaptKpiRegression({
    baseline: hidden,
    current: hidden,
    baselinePath: "baseline.json",
    currentPath: "current.json",
    generatedAt: "2026-10-02T00:00:00.000Z",
    minWorthRatio: 0.97,
    maxStallDelta: 0.03,
    maxDroppedDelta: 0.03,
    minVisibleProgressRatio: 0.9,
    maxNoRewardGapDelta: 60,
  });
  expect(legacy.experienceChecks[0]?.pass.visibleProgress).toBe(true);
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-assertion-grammar The safe term is supported and an unsafe expression is not executed.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-assertion-grammar #2ad185e Re-read the section, then ran this function: t <= 7200 is supported and process.exit is unsupported.
 * @evidence ./checks.ts#balanceAssertionGrammar Reads the grammar marker.
 * @evidenceReview ./checks.ts#balanceAssertionGrammar #423cfbe The declaration is declaration-only.
 * @evidence ./checks.ts#classifyAssertionExpr Classifies an assertion without executing it.
 * @evidenceReview ./checks.ts#classifyAssertionExpr #5fe7abd Two safe terms joined by && are one supported clause, and a call expression is unsupported.
 */
export function classifiesAssertionGrammar(): void {
  expect(balanceAssertionGrammar).toBe("declaration-only");
  const supported = classifyAssertionExpr("t <= 7200 && prestige.count >= 1");
  expect(supported.status).toBe("supported");
  if (supported.status === "supported") expect(supported.terms[0]).toHaveLength(2);
  expect(classifyAssertionExpr("process.exit(1)").status).toBe("unsupported");
  const compile = readFileSync(new URL("../../scenario/compile.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../../scenario/types.ts", import.meta.url), "utf8");
  expect(compile.includes("classifyAssertionExpr")).toBe(false);
  expect(compile.includes("outputs.assertions are not compiled")).toBe(true);
  expect(types.includes("Declaration only")).toBe(true);
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-numeric-advisory Advisory text stays beside the verdict, and the seeded check does not fetch.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-numeric-advisory #80bc2bf Re-read the section, then ran this function with seed 17: a failing 3h check stays fail while fetch is untouched.
 * @evidence ./checks.ts#balanceNumericAdvisory Reads the advisory marker.
 * @evidenceReview ./checks.ts#balanceNumericAdvisory #48e63e8 The declaration is numeric-not-advisory.
 * @evidence ./checks.ts#renderBalanceCheckMarkdown Renders the failing metric and the advisory.
 * @evidenceReview ./checks.ts#renderBalanceCheckMarkdown #b75a3fe The failed first-reset row shows its value, and the advisory section says it is not a pass or fail.
 */
export function keepsAdvisoryOffTheVerdict(): void {
  expect(balanceNumericAdvisory).toBe("numeric-not-advisory");
  const calls: string[] = [];
  const prior = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    throw new Error("network");
  }) as unknown as typeof fetch;
  try {
    const spec = check({ id: "first-reset", metricId: "first-reset", operator: "lte", threshold: 2 });
    const report = evaluateBalanceChecks(
      request([spec], [observation("first-reset", "measured", 3, 3, 3)], "advisory text is not a verdict"),
    );
    expect(report.results[0]?.verdict).toBe("fail");
    expect(report.advisory).toBe("advisory text is not a verdict");
    expect(report.pass).toBe(false);
    expect(report.externalProvider).toBe(false);
    expect(calls).toEqual([]);
    const markdown = renderBalanceCheckMarkdown(report);
    expect(markdown).toContain("first-reset");
    expect(markdown).toContain("3");
    expect(markdown).toContain("Advisory is not a pass or fail.");
  } finally {
    globalThis.fetch = prior;
  }
}

/**
 * @evidence docs/requirements/active/balance-checks.md#req-pr17-failure-report The error document validates and a blocking result uses exit 2.
 * @evidenceReview docs/requirements/active/balance-checks.md#req-pr17-failure-report #fd8c2d1 Re-read the section, then ran this function: the schema is 3.1 and an unsupported metric does not pass.
 * @evidence ./checks.ts#balanceFailureReport Reads the failure marker.
 * @evidenceReview ./checks.ts#balanceFailureReport #73992b0 The declaration is failure-exit-two.
 * @evidence ./checks.ts#validateBalanceCheckReport Reads the published validator.
 * @evidenceReview ./checks.ts#validateBalanceCheckReport #c774d46 The validator accepts the report and the error document and rejects a bare version.
 * @evidence ./checks.ts#balanceChecksJsonSchema Reads the generated schema.
 * @evidenceReview ./checks.ts#balanceChecksJsonSchema #9e85272 The schema version is 3.1.
 * @evidence ./checks.ts#balanceChecksSchemaId Reads the schema id.
 * @evidenceReview ./checks.ts#balanceChecksSchemaId #bbe8506 The id is the balance-checks v1 schema URL.
 * @evidence ./checks.ts#balanceChecksAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ./checks.ts#balanceChecksAlgorithmVersion #250db50 The version is balance-checks-1 and matches the report.
 * @evidence ./checks.ts#toBalanceCheckError Builds the error document from a blocking report.
 * @evidenceReview ./checks.ts#toBalanceCheckError #460c1d0 The unsupported result is the only failed row and the error exits 2.
 */
export function validatesFailureReport(): void {
  expect(balanceFailureReport).toBe("failure-exit-two");
  expect(balanceChecksJsonSchema().version).toBe("3.1");
  expect(balanceChecksSchemaId()).toBe("https://idlekit.dev/schemas/balance-checks.v1.schema.json");
  const spec = check({ id: "p95-goal", metricId: "p95-goal", operator: "lte", threshold: 8, missingPolicy: "fail" });
  const report = evaluateBalanceChecks(request([spec], [observation("p95-goal", "unsupported", null, null, null)]));
  expect(report.pass).toBe(false);
  expect(report.exitCode).toBe(2);
  expect(report.algorithmVersion).toBe(balanceChecksAlgorithmVersion());
  const error = toBalanceCheckError(report);
  expect(error.kind).toBe("balance-check-error");
  expect(error.exitCode).toBe(2);
  expect(error.failed[0]?.verdict).toBe("unsupported");
  expect(error.failed).toHaveLength(1);
  expect(validateBalanceCheckReport(report).success).toBe(true);
  expect(validateBalanceCheckReport(error).success).toBe(true);
  expect(validateBalanceCheckReport({ schemaVersion: 1 }).success).toBe(false);
  const warn = evaluateBalanceChecks({
    ...request([check({ id: "soft", metricId: "first-reset", operator: "lte", threshold: 2, severity: "warn" })], [
      observation("first-reset", "measured", 3, 3, 3),
    ]),
    failOn: ["error"],
  });
  expect(warn.results[0]?.verdict).toBe("fail");
  expect(warn.pass).toBe(true);
  expect(warn.exitCode).toBe(0);
}

describe("balance checks", () => {
  it("checks a registered metric spec", checksRegisteredMetrics);
  it("judges bounded metrics", judgesBoundedMetrics);
  it("reports an identity mismatch", reportsIdentityMismatch);
  it("adapts kpi regression", adaptsKpiRegression);
  it("classifies assertion grammar", classifiesAssertionGrammar);
  it("keeps advisory off the verdict", keepsAdvisoryOffTheVerdict);
  it("validates the failure report", validatesFailureReport);
});
