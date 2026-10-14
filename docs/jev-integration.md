# Jev integration

Korean version: [jev-integration_ko.md](./jev-integration_ko.md)

`PR-19` adds an opt-in Jev provider on `idk judge`. It sends an allowlisted projection of a finished analysis artifact. It does not replace the balance-check gate, the rules judge, ttsc, Evidence, or Graph. A Jev answer is not numerical evidence and it is not requirement-review approval.

The default remains local. `idk judge --provider rules`, `idk evaluate`, `idk tune`, `idk doctor`, and `idk validate` do not call the network, even when `TYPESAFE_API_KEY` is set. `--provider jev` is the only switch that may connect. `judge` loads the provider module only after that switch, so the other commands do not load it either. `--dry-run` prints the planned endpoint and request count and does not send.

Successful HTTP response bodies are read with a 1 MiB byte limit; an oversized response fails without a retry. Error response bodies are discarded before buffering. Missing evidence with an `unsupported` policy asks Jev to abstain. Cache path depth counts symlink hops rather than ordinary parent directories.

Model names are trimmed and must be nonempty before a request is planned or sent. A `between` rule without ordered finite bounds asks for abstention. Cache hits require exactly the current question IDs and answer types, with dispositions and the report summary consistent with the recorded numerical results.

Cached records must preserve the provider endpoint and model policy, pass the secret and local-path checks, and contain only the advisory report fields.
Resolved model IDs must be nonempty and have no leading or trailing whitespace, in both responses and cache replay.

The wire was rechecked against the TypeSafe System One docs on 2026-10-02. The call is POST `https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and `Content-Type: application/json`. The key name in the environment is `TYPESAFE_API_KEY`. The request model field is required. The docs example request model is `jev-latest`, and the docs example resolved model is `jev-1.13.0`. Choice and Score answers carry `probabilities` and `confidence`. A Noul answer carries `noul` only. Those shapes are not collapsed into one confidence field. `confidence` is a statistic of the probability distribution, from 0 to 1. It is not a calibrated probability that the game balance is correct. Noul has no confidence field. The fetched pages do not state a unit price, so this provider does not invent one. It reports `usage.input_tokens` and `usage.output_tokens` when a response arrives.

The projection keeps metric id, version, meaning, domain, unit, method, reading, status, value, assumptions, and the rubric rule's operator, threshold, upper threshold, unit, method, definition, and recommendation id. It drops raw source, plugin code, the full artifact, and secret-looking keys. An amount reading carries its decimal and sign. A local path anywhere in a string is replaced: POSIX absolute at any depth, `~/`, Windows drive, UNC, and `file:` forms, including a name with spaces up to the file it names. A web URL stays. A rule id that holds a path or the key is refused before the request, because ids are sent as question names. The key is read from the process environment for the request header and is not written to the cache, the report, or the error text.

`401` and `403` are authentication failures and are not retried. `429`, `529`, and other `5xx` responses retry at most twice, then the advisory status is `unavailable`. A timeout aborts and is `unavailable`. The numerical report is still written. `numerical.pass` is not flipped. Low confidence and a Noul value near one half are `abstain`. Each question asks whether the recorded reading fails its rule. A Noul value that disagrees with the verdict of its own rule is `advisory-warning`, and that warning outranks an abstention on another rule in the report status. An inconclusive or unsupported rule has no verdict to disagree with. A Noul value outside 0 to 1, or a Score confidence outside it, is a malformed response, and the abstain band runs from 0.4 to 0.6 inclusive. A rubric with a repeated rule id or the id `__proto__` fails before the request, because each rule must stay its own question.

The cache key binds the projection, the numerical digest, the rubric version, schema version 1, the adapter version, and the requested model. A pinned model such as `jev-1.13.0` hits only when the stored resolved model is that same id. `jev-latest` is an alias. The cache stores the response model and expires after 24 hours. Changing the requested model or the rubric misses. A cache that cannot be written fails open and does not resend the request, and a stored advisory that does not validate is a miss. Cache replay is not a new live call.

The structural contract is `idlekit.jev.advisory.v1` at [docs/schemas/jev.advisory.v1.schema.json](./schemas/jev.advisory.v1.schema.json). The generator also writes [docs/schemas/generated/jev.advisory.v1.schema.json](./schemas/generated/jev.advisory.v1.schema.json). The rules report stays [docs/schemas/judge.output.schema.json](./schemas/judge.output.schema.json). `--provider jev --format json` writes both reports with `_meta` (csv is refused), and its `schemaRef` is [docs/schemas/jev.judge.output.schema.json](./schemas/jev.judge.output.schema.json), which references the other two. The wire samples live in [examples/analysis/jev-wire.json](../examples/analysis/jev-wire.json). Reproduction label is `19`. Ordinary tests use a mock transport. A paid live smoke is not part of this run.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Commands

```bash
idk judge analysis.json --rubric rubric.json --provider rules
idk judge analysis.json --rubric rubric.json --provider jev --dry-run
idk judge analysis.json --rubric rubric.json --provider jev --model jev-1.13.0
```

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `b5060ae1ac87ca7e71b9ee46e9792f7de2eef8676693edf6096536b3d254bc14`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, and `docs:verify` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test --timeout 90000 src/lib/evaluation/providers/jev.test.ts src/commands/judge.test.ts` (from `packages/cli`) | 0 |
| `bun run generate` (from `packages/cli`) | 0 |
| `bun run generate:check` (from `packages/cli`) | 0 |
| `bun run doctor:completions` (from `packages/cli`) | 0 |
| `bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts` | 0 |
| `bun run contracts:check` | 0 |
| `bun test --timeout 120000 src/scenario/scenarioContract.test.ts` (from `packages/core`) | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run runtime:check` | 0 |
| `bun run public:check` | 0 |

The first `evidence:check` exited 2 on placeholder reviews. The next exited 1 because the inventory looks for `export function` and the hosts were still `export async function`. The rerun exited 0. `contracts:generate` ran again after those reviews, then `contracts:check` exited 0. `graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0.

The PR #221 review fixes changed the requirement file to sha256 `7ca16ab408f048a0b17e84072aae5e74afc5b3a7430bbcf79d483f011269a806`. That revision ran `bun run typecheck`, `bun run test:conformance`, `bun run contracts:check`, and `jev.test.ts`, `judge.test.ts`, and `output-schema.test.ts` from `packages/cli`.

## Graph

Queried at commit `18f4208` (the PR #221 review fixes) with `ttsc-graph` 0.30.4 on `tsconfig.graph.json` through `bun tools/graph-query.ts`, protocol `2025-11-25`, no generation identifier, shutdown 0. Lookup places `adviseWithJev` at `packages/cli/src/lib/evaluation/providers/jev.ts:393`, `projectJevState` at `packages/cli/src/lib/evaluation/providers/jev.ts:139`, `createFetchTransport` at `packages/cli/src/lib/evaluation/providers/jev.ts:225`, `jevCacheKey` at `packages/cli/src/lib/evaluation/cache.ts:22`, and `runJudge` at `packages/cli/src/commands/judge.ts:46`. A reverse trace (`maxDepth` 2, `maxNodes` 32) of `adviseWithJev` names the hosts `boundsHttpFailures`, `separatesCacheIdentity`, `keepsSecretsOutOfRecords`, `keepsNumericalVerdicts`, and `staysOptIn` in `jev.test.ts`. It does not name `runJudge`: `judge.ts` now loads the provider with a dynamic `import()`, which the graph does not observe, so that edge was checked by reading `packages/cli/src/commands/judge.ts` and by the static import walk in `keepsDefaultCommandsOffNetwork`. `graph:check` at the original re-land reported `ok unobserved createPlannerStrategy -> stepOnce (call is PlannerDeps.stepOnce; path hops=0; source default { stepOnce })`. Hops 0 is not conformance.
