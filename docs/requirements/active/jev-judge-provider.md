# Jev judge provider

## Default commands stay off the network {#req-pr19-no-default-fetch}

Requirement `REQ-PR19-NO-DEFAULT-FETCH`. `PR-19` owns it.

`jevNoDefaultFetch` is `rules-stay-local`. `provider=rules` does not call the Jev transport, even when `TYPESAFE_API_KEY` is set. `evaluate`, `tune`, `doctor`, and `validate` do not import the provider. Core does not import it. Seed `19` labels `examples/analysis/jev-wire.json`.

The executed test is `keepsDefaultCommandsOffNetwork` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Choice, Score, and Noul stay distinct {#req-pr19-wire-shapes}

Requirement `REQ-PR19-WIRE-SHAPES`. `PR-19` owns it.

`jevWireShapes` is `distinct-answer-types`. The wire endpoint rechecked for this change is POST `https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and `TYPESAFE_API_KEY`. Choice and Score carry `probabilities` and `confidence`. Noul carries `noul` and does not carry `confidence`. Unknown question ids, a probability shape that misses an option, and malformed JSON are rejected. The report contract is `idlekit.jev.advisory.v1`. `validateJevAdvisory` is `typia.createValidate<JevAdvisoryV1>()`. The structural schema is `typia.json.schema<JevAdvisoryV1, "3.1">()`.

The executed test is `validatesWireShapes` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## HTTP failures stay inside a budget {#req-pr19-http-budget}

Requirement `REQ-PR19-HTTP-BUDGET`. `PR-19` owns it.

`jevHttpBudget` is `bounded-retry`. `401` and `403` are authentication and are not retried. `429`, `529`, and `5xx` retry at most twice. A timeout aborts and the advisory status is `unavailable`. The response body is not copied into the report. No currency price is hardcoded.

The executed test is `boundsHttpFailures` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Cache identity follows the pinned model {#req-pr19-cache-identity}

Requirement `REQ-PR19-CACHE-IDENTITY`. `PR-19` owns it.

`jevCacheIdentity` is `alias-is-not-pinned`. The key binds the projection, the numerical digest, the rubric version, the schema version, the adapter version, and the requested model. The same pinned model hits. A rubric change misses. `jev-latest` stores the resolved model and expires after 24 hours. The alias is not a permanent id.

The executed test is `separatesCacheIdentity` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Secrets stay out of records {#req-pr19-secret-boundary}

Requirement `REQ-PR19-SECRET-BOUNDARY`. `PR-19` owns it.

`jevSecretBoundary` is `redacted-projection`. The state sent to Jev is an allowlist of metrics, assumptions, and rubric intent. The API key, a local path, plugin source, and the raw artifact marker are not written to the request, the cache, or the report.

The executed test is `keepsSecretsOutOfRecords` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Numerical verdicts stay put {#req-pr19-numerical-unchanged}

Requirement `REQ-PR19-NUMERICAL-UNCHANGED`. `PR-19` owns it.

`jevNumericalUnchanged` is `verdict-stays`. A Jev answer that disagrees with the numerical check is `advisory-warning`. Confidence below one half, and a Noul value near one half, is `abstain`. Neither one turns the numerical pass bit into a success. Confidence is not a calibrated game-correctness probability.

The executed test is `keepsNumericalVerdicts` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Live calls are opt-in {#req-pr19-opt-in-live}

Requirement `REQ-PR19-OPT-IN-LIVE`. `PR-19` owns it.

`jevOptInLive` is `mock-unless-opt-in`. Dry-run reports the endpoint and sends nothing. A missing key is `unavailable` and sends nothing. The injected fetch transport posts to the documented endpoint. The ordinary test uses that mock. A paid live smoke is not part of this run.

The executed test is `staysOptIn` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.
