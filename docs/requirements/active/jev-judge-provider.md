# Jev judge provider

## Default commands stay off the network {#req-pr19-no-default-fetch}

Requirement `REQ-PR19-NO-DEFAULT-FETCH`. `PR-19` owns it.

`jevNoDefaultFetch` is `rules-stay-local`. `provider=rules` does not call the Jev transport, even when `TYPESAFE_API_KEY` is set. `evaluate`, `tune`, `doctor`, and `validate` do not import the provider. `main.ts` registers `judge` for every invocation, so `judge` imports the provider type only and loads the provider with a dynamic `import()` after `--provider jev`. The static import graph from `main.ts` does not reach `providers/jev`. Core does not import it. Seed `19` labels `examples/analysis/jev-wire.json`.

The executed test is `keepsDefaultCommandsOffNetwork` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Choice, Score, and Noul stay distinct {#req-pr19-wire-shapes}

Requirement `REQ-PR19-WIRE-SHAPES`. `PR-19` owns it.

`jevWireShapes` is `distinct-answer-types`. The wire endpoint rechecked for this change is POST `https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and `TYPESAFE_API_KEY`. Choice and Score carry `probabilities` and `confidence`. Noul carries `noul` and does not carry `confidence`. Unknown question ids, a probability shape that misses an option, a Noul value or a Choice or Score confidence outside 0 to 1, and malformed JSON are rejected. The report contract is `idlekit.jev.advisory.v1`. `validateJevAdvisory` is `typia.createValidate<JevAdvisoryV1>()`. The structural schema is `typia.json.schema<JevAdvisoryV1, "3.1">()`.

The executed test is `validatesWireShapes` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## HTTP failures stay inside a budget {#req-pr19-http-budget}

Requirement `REQ-PR19-HTTP-BUDGET`. `PR-19` owns it.

`jevHttpBudget` is `bounded-retry`. `401` and `403` are authentication and are not retried. `429`, `529`, and `5xx` retry at most twice. A timeout aborts and the advisory status is `unavailable`. The response body is not copied into the report. No currency price is hardcoded.

The executed test is `boundsHttpFailures` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Cache identity follows the pinned model {#req-pr19-cache-identity}

Requirement `REQ-PR19-CACHE-IDENTITY`. `PR-19` owns it.

`jevCacheIdentity` is `alias-is-not-pinned`. The projection carries each rule's operator, threshold, upper threshold, unit, method, and definition, so changing only the upper bound of a `between` rule misses. The key binds the projection, the numerical digest, the rubric version, the schema version, the adapter version, and the requested model. The same pinned model hits. A rubric change misses. `jev-latest` stores the resolved model and expires after 24 hours. A cache that cannot be written fails open: the advisory stands and the request is not sent again. A stored advisory that does not parse or validate is a miss. The alias is not a permanent id.

The executed test is `separatesCacheIdentity` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Secrets stay out of records {#req-pr19-secret-boundary}

Requirement `REQ-PR19-SECRET-BOUNDARY`. `PR-19` owns it.

`jevSecretBoundary` is `redacted-projection`. The state sent to Jev is an allowlist of metrics, assumptions, and rubric intent. A metric carries its recorded meaning, version, method, and unit, which the numerical judge compares with the rule, and an amount reading carries its decimal and sign. Only the first reading of a metric id, the one the numerical judge reads, is projected. A rule carries its missing policy. The API key, a local path, plugin source, and the raw artifact marker are not written to the request, the cache, or the report. A local path is a POSIX absolute path, a `~/` path, a Windows drive or UNC path, or a `file:` URI, anywhere in a string. Only the path is replaced. A path whose name holds a space runs through the next token that names a file, or to the closing delimiter or the end of the string. A web URL stays.

The executed test is `keepsSecretsOutOfRecords` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Numerical verdicts stay put {#req-pr19-numerical-unchanged}

Requirement `REQ-PR19-NUMERICAL-UNCHANGED`. `PR-19` owns it.

`jevNumericalUnchanged` is `verdict-stays`. Each question asks whether the recorded reading fails its rule, the same predicate as the numerical check. A Jev answer that disagrees with the numerical check of its own rule is `advisory-warning`. The comparison uses that rule's verdict, not the report-wide pass bit. An inconclusive or unsupported rule has no verdict to disagree with. Each rule is one question, so a rubric with a repeated rule id or the id `__proto__` fails before any send. Confidence below one half, and a Noul value from 0.4 to 0.6 inclusive, is `abstain`. Neither one turns the numerical pass bit into a success. A warning on any rule outranks an abstention on another in the report status. Confidence is not a calibrated game-correctness probability.

The executed test is `keepsNumericalVerdicts` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Live calls are opt-in {#req-pr19-opt-in-live}

Requirement `REQ-PR19-OPT-IN-LIVE`. `PR-19` owns it.

`jevOptInLive` is `mock-unless-opt-in`. Dry-run reports the endpoint and sends nothing. A missing key is `unavailable` and sends nothing. The injected fetch transport posts to the documented endpoint. JSON output names `docs/schemas/jev.judge.output.schema.json`, which describes the whole bundle and requires all three parts: the rules report, the advisory, and `_meta`. `--provider jev` refuses `--format csv`. The ordinary test uses that mock. A paid live smoke is not part of this run.

The executed test is `staysOptIn` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.
