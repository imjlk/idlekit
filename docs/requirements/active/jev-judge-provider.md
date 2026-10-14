# Jev judge provider

## Default commands stay off the network {#req-pr19-no-default-fetch}

Requirement `REQ-PR19-NO-DEFAULT-FETCH`. `PR-19` owns it.

`jevNoDefaultFetch` is `rules-stay-local`. `provider=rules` does not call the Jev transport, even when `TYPESAFE_API_KEY` is set. `evaluate`, `tune`, `doctor`, and `validate` do not import the provider. `main.ts` registers `judge` for every invocation, so `judge` imports the provider type only and loads the provider with a dynamic `import()` after `--provider jev`. The static import graph from `main.ts` does not reach `providers/jev`. Core does not import it. Seed `19` labels `examples/analysis/jev-wire.json`.

The executed test is `keepsDefaultCommandsOffNetwork` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Choice, Score, and Noul stay distinct {#req-pr19-wire-shapes}

Requirement `REQ-PR19-WIRE-SHAPES`. `PR-19` owns it.

`jevWireShapes` is `distinct-answer-types`. The wire endpoint rechecked for this change is POST `https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and `TYPESAFE_API_KEY`. Choice and Score carry `probabilities` and `confidence`. Noul carries `noul` and does not carry `confidence`. Unknown question ids, a probability shape that misses an option, a Noul value or a Choice or Score confidence outside 0 to 1, a negative token count, and malformed JSON are rejected. The advisory contract types token counts, attempts, and planned requests as `uint32`, and each answer as its own variant: Noul with `noul` on 0 to 1 and no confidence, Choice and Score with a confidence on 0 to 1. The report contract is `idlekit.jev.advisory.v1`. `validateJevAdvisory` is `typia.createValidate<JevAdvisoryV1>()`. The structural schema is `typia.json.schema<JevAdvisoryV1, "3.1">()`.

The executed test is `validatesWireShapes` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## HTTP failures stay inside a budget {#req-pr19-http-budget}

Requirement `REQ-PR19-HTTP-BUDGET`. `PR-19` owns it.

`jevHttpBudget` is `bounded-retry`. `401` and `403` are authentication and are not retried. `429`, `529`, and `5xx` retry at most twice. A timeout aborts and the advisory status is `unavailable`. The response body is not copied into the report. No currency price is hardcoded.

The executed test is `boundsHttpFailures` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Cache identity follows the pinned model {#req-pr19-cache-identity}

Requirement `REQ-PR19-CACHE-IDENTITY`. `PR-19` owns it.

`jevCacheIdentity` is `alias-is-not-pinned`. The projection carries each rule's operator, threshold, upper threshold, unit, method, and definition, so changing only the upper bound of a `between` rule misses. The key binds the projection, the numerical digest, the rubric version, the schema version, the adapter version, and the requested model. The same pinned model hits. A rubric change misses. `jev-latest` stores the response model and expires after 24 hours, whether the response echoes that alias or returns a concrete id. After the CLI rejects non-regular cache/output targets and paths beneath a non-directory parent, a cache that cannot be written fails open: the advisory stands and the request is not sent again. A stored advisory that does not parse or validate is a miss, a cache entry missing any field is dropped, and a stored advisory that names another numerical digest, rubric version, or model is a miss. `--cache` naming the output or an input file, by path, symlink, dangling symlink, hard link, or a symlinked parent directory, is refused. Identical cold-cache requests take a per-key filesystem lease and recheck the cache before calling the transport; different keys remain concurrent, and writes merge entries under a separate heartbeat lease. A busy per-key lease returns unavailable without a second paid request. An output and cache cannot be ancestor paths. An alias entry stored in the future is not fresh. A pinned request accepts only that model in the response. An alias accepts either the same alias or a concrete id; a different alias is `model-mismatch`. The alias is not a permanent id. Writes remove expired alias entries and retain at most the 256 most recently written records, evicting older records when necessary.

The executed test is `separatesCacheIdentity` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Secrets stay out of records {#req-pr19-secret-boundary}

Requirement `REQ-PR19-SECRET-BOUNDARY`. `PR-19` owns it.

`jevSecretBoundary` is `redacted-projection`. The state sent to Jev is an allowlist of metrics, assumptions, and rubric intent. A metric carries its recorded meaning, version, method, and unit, which the numerical judge compares with the rule, and an amount reading carries decimal context without a usable numerical point or sign. Only metrics a rule names are projected, and only the first reading of a metric id, the one the numerical judge reads, and only an observed reading with status `ok` carries its value; other readings carry the Core observation status instead of a measured point or sign. The shared Core mapper supplies effective method, unit, unspecified provenance fields, and artifact algorithm version; each question abstains on identity mismatches, unknown coverage, and unsupported observations before considering the numerical predicate. A requested or response model string that carries the key or a local path is refused as `unsafe-model`, is not cached, and is reported only as `[redacted]`. A rubric version that does is refused as `unsafe-rubric-version` the same way. A rule carries its missing policy and the optional identity constraints the numerical judge checks: scenario, spec, engine, plugin, seed, and algorithm version. The API key, a local path, plugin source, and the raw artifact marker are not written to the request, the cache, or the advisory. The CLI also rejects unsafe metadata in the unchanged sibling numerical report before a transport call or bundle output, including dry runs. A local path is a POSIX absolute path, a `~/` path, a Windows drive or UNC path, or a `file:` URI, anywhere in a string. A root-level path such as `/secret.json` counts. Only the path is replaced. A rule id is a request property name and is not redacted, so a rubric whose rule id holds a path or the key fails before any send. A path whose name holds a space runs through the next token that names a file, or to the closing delimiter or the end of the string. A web URL stays.

The executed test is `keepsSecretsOutOfRecords` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Numerical verdicts stay put {#req-pr19-numerical-unchanged}

Requirement `REQ-PR19-NUMERICAL-UNCHANGED`. `PR-19` owns it.

`jevNumericalUnchanged` is `verdict-stays`. Each question asks whether the recorded reading fails its rule, the same predicate as the numerical check. A Jev answer that disagrees with the numerical check of its own rule is `advisory-warning`. The comparison uses that rule's verdict, not the report-wide pass bit. An inconclusive or unsupported rule has no verdict to disagree with. Each rule is one question, so a rubric with a repeated rule id or the id `__proto__` fails before any send. Confidence below one half, and a Noul value from 0.4 to 0.6 inclusive, is `abstain`. Neither one turns the numerical pass bit into a success. A warning on any rule outranks an abstention on another in the report status. Confidence is not a calibrated game-correctness probability.

The executed test is `keepsNumericalVerdicts` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.

## Live calls are opt-in {#req-pr19-opt-in-live}

Requirement `REQ-PR19-OPT-IN-LIVE`. `PR-19` owns it.

`jevOptInLive` is `mock-unless-opt-in`. Dry-run reports the endpoint and the planned request count, in json and in md, and sends nothing. A warm cache, a cache hit, and a missing key plan zero requests. `--format md --out` writes the file. A request over the input limit is refused before the plan, live or dry, and plans no request. A missing key is `unavailable` and sends nothing. The injected fetch transport posts to the documented endpoint. JSON output names `docs/schemas/jev.judge.output.schema.json`, which describes the whole bundle and requires all three parts: the rules report, the advisory, and `_meta`. `--provider jev` refuses `--format csv`. The ordinary test uses that mock. A paid live smoke is not part of this run.

The executed test is `staysOptIn` in `packages/cli/src/lib/evaluation/providers/jev.test.ts`.
