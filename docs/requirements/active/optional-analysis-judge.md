# Optional analysis judge

## The rules provider is the judge contract {#req-pr18-rules-provider}

Requirement `REQ-PR18-RULES-PROVIDER`. `PR-18` owns it.

`judgeRulesProvider` is `rules-not-vendor`. `idk judge` reads a validated analysis artifact and a versioned rubric and returns advisory findings. The provider name is `rules`. The report contract is `idlekit.judge.v1`. `externalProvider` is false. The structural schema is `typia.json.schema<JudgeReportV1, "3.1">()`. The interface does not expose a vendor response type. Seed `18` labels the hour examples below. The same artifact and rubric produce the same advisory digest, and the path performs no fetch.

The executed test is `acceptsRulesProvider` in `packages/core/src/sim/analysis/judge.test.ts`.

## Numeric thresholds reuse the check engine {#req-pr18-check-reuse}

Requirement `REQ-PR18-CHECK-REUSE`. `PR-18` owns it.

`judgeCheckReuse` is `checks-not-recomputed`. A measured first reset of 1.5h passes `lte` 2. A measured 3h fails inside the numerical report. The rules provider does not recompute that metric and does not replace the balance-check verdict. An amount decimal is not narrowed to a JavaScript number.

The executed test is `reusesBalanceChecks` in `packages/core/src/sim/analysis/judge.test.ts`.

## Evidence refs must exist {#req-pr18-evidence-refs}

Requirement `REQ-PR18-EVIDENCE-REFS`. `PR-18` owns it.

`judgeEvidenceRefs` is `existing-refs-only`. A rubric schema version other than 1 is rejected. An artifact algorithm version other than `analysis-artifact-v1` is rejected. A rule whose metric id is absent from the artifact is rejected. A rule may pin `metricVersion`; it then reads only that version of its metric id, so a rule pinned to version 1 is rejected as a missing ref against an artifact that carries only version 2. A rule that pins no version (the field omitted or null, as in every rubric written before the field existed) reads its metric id at any version. Each diagnostic's evidence refs are `metric:<id>` and then `metric-version:<n>` for the version it read, so the v1 report shape gains no field. One rule must match exactly one reading. The rubric is validated as data. An unknown field is not executed.

The executed test is `rejectsBadRefs` in `packages/core/src/sim/analysis/judge.test.ts`.

## Three layers stay apart {#req-pr18-separated-report}

Requirement `REQ-PR18-SEPARATED-REPORT`. `PR-18` owns it.

`judgeSeparatedReport` is `layers-stay-apart`. The numerical check report, estimated observations, and semantic diagnostics are separate fields. A 3h conflict is advisory status `conflict` with recommendation `rec.metric.outside-threshold`. `baselineRewrite` stays false. The numerical verdict remains fail. English and Korean sentences come from that recommendation id.

The executed test is `separatesReportLayers` in `packages/core/src/sim/analysis/judge.test.ts`.

## Missing information is not a health label {#req-pr18-insufficient}

Requirement `REQ-PR18-INSUFFICIENT`. `PR-18` owns it.

`judgeInsufficient` is `not-a-health-label`. An unavailable reading, an unknown metrics capability, and incomplete coverage stay `insufficient`. An estimated 1.5h is listed under estimated observations and is not a measured pass. The report does not use a health label.

The executed test is `withholdsHealthLabels` in `packages/core/src/sim/analysis/judge.test.ts`.
