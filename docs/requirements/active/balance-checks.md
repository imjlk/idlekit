# Balance checks

## A check is a registered metric comparison {#req-pr17-check-spec}

Requirement `REQ-PR17-CHECK-SPEC`. `PR-17` owns it.

`balanceCheckSpec` is `registered-check-spec`. A check names a metric id, a comparison operator, a threshold, a unit, a severity, and a missing policy. The operators are `lt`, `lte`, `gt`, `gte`, `eq`, and `between`. Severity is `error` or `warn`. Missing policy is `inconclusive`, `fail`, or `unsupported`. The default path does not evaluate arbitrary JavaScript. Seed `17` is the reproduction seed for the hour examples below.

The executed test is `checksRegisteredMetrics` in `packages/core/src/sim/analysis/checks.test.ts`.

## Bounds decide pass and fail {#req-pr17-verdict-bounds}

Requirement `REQ-PR17-VERDICT-BOUNDS`. `PR-17` owns it.

`balanceVerdictBounds` is `bounds-not-zero`. A measured first reset of 1.5h passes `lte` 2h. A measured 3h fails. An unknown p95 with no bounds is inconclusive and does not pass `lte` 8h. A censored lower bound of 9h fails that same 8h check. A missing metric, including a stored 0, is not treated as 0 and does not pass. Active actions of 3 per minute pass a range of 1 to 5. 0 and 9 fail. An unsupported metric stays unsupported.

The executed test is `judgesBoundedMetrics` in `packages/core/src/sim/analysis/checks.test.ts`.

## Identity mismatches are not rewritten {#req-pr17-identity-mismatch}

Requirement `REQ-PR17-IDENTITY-MISMATCH`. `PR-17` owns it.

`balanceIdentityMismatch` is `mismatch-not-rewritten`. A unit of `h` compared with `s`, an engine of `number` compared with `breakInfinity`, and algorithm version `1` compared with `2` are mismatches. The verdict is inconclusive. `baselineRewrite` stays false. There is no baseline update flag.

The executed test is `reportsIdentityMismatch` in `packages/core/src/sim/analysis/checks.test.ts`.

## KPI regression is an adapter {#req-pr17-kpi-adapter}

Requirement `REQ-PR17-KPI-ADAPTER`. `PR-17` owns it.

`balanceKpiAdapter` is `kpi-adapter`. `idk kpi regress` maps the existing a/b `at7d`, `at30d`, and `at90d` rows into the shared engine. Identical worth `100`, stall `0.1`, dropped `0.02`, visible changes `4`, and a no-reward gap of `30` pass the default ratios. Current worth `1` fails. The command still exits 2 when the adapter pass bit is false. Flags and the fixture shape stay.

The executed test is `adaptsKpiRegression` in `packages/core/src/sim/analysis/checks.test.ts`.

## Scenario assertions stay declaration-only {#req-pr17-assertion-grammar}

Requirement `REQ-PR17-ASSERTION-GRAMMAR`. `PR-17` owns it.

`balanceAssertionGrammar` is `declaration-only`. `ScenarioV1.outputs.assertions` is stored and is not executed by simulate or evaluate. The supported grammar is a path, a comparison operator, and a value, joined by `&&` and `||`. `t <= 7200 && prestige.count >= 1` is supported. `process.exit(1)` is unsupported and is not executed.

The executed test is `classifiesAssertionGrammar` in `packages/core/src/sim/analysis/checks.test.ts`.

## Advisory text is not the verdict {#req-pr17-numeric-advisory}

Requirement `REQ-PR17-NUMERIC-ADVISORY`. `PR-17` owns it.

`balanceNumericAdvisory` is `numeric-not-advisory`. The numeric verdict and the advisory string are stored apart. Advisory text does not turn a failing 3h first-reset check into a pass. The default check path performs no fetch. Seed `17` reproduces that check. An external provider is not required.

The executed test is `keepsAdvisoryOffTheVerdict` in `packages/core/src/sim/analysis/checks.test.ts`.

## A blocking result exits 2 {#req-pr17-failure-report}

Requirement `REQ-PR17-FAILURE-REPORT`. `PR-17` owns it.

`balanceFailureReport` is `failure-exit-two`. A blocking result sets `exitCode` to 2. Usage errors stay on the CLI usage path. The error document kind is `balance-check-error` and validates with the report. The structural schema is `typia.json.schema<BalanceCheckDocumentV1, "3.1">()` registered as `idlekit.balance-checks.v1`. Unsupported, error, and missing results do not become pass. A warn failure does not fail the process when `--fail-on` is `error`.

The executed test is `validatesFailureReport` in `packages/core/src/sim/analysis/checks.test.ts`.
