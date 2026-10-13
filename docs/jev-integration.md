# Jev integration

Korean version: [jev-integration_ko.md](./jev-integration_ko.md)

`PR-19` adds an opt-in Jev provider on `idk judge`. It sends an allowlisted projection of a finished analysis artifact. It does not replace the balance-check gate, the rules judge, ttsc, Evidence, or Graph. A Jev answer is not numerical evidence and it is not requirement-review approval.

The default remains local. `idk judge --provider rules`, `idk evaluate`, `idk tune`, `idk doctor`, and `idk validate` do not call the network, even when `TYPESAFE_API_KEY` is set. `--provider jev` is the only switch that may connect. `judge` loads the provider module only after that switch, so the other commands do not load it either. `--dry-run` prints the planned endpoint and request count and does not send.

The wire was rechecked against the TypeSafe System One docs on 2026-10-02. The call is POST `https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and `Content-Type: application/json`. The key name in the environment is `TYPESAFE_API_KEY`. The request model field is required. The docs example request model is `jev-latest`, and the docs example resolved model is `jev-1.13.0`. Choice and Score answers carry `probabilities` and `confidence`. A Noul answer carries `noul` only. Those shapes are not collapsed into one confidence field. `confidence` is a statistic of the probability distribution, from 0 to 1. It is not a calibrated probability that the game balance is correct. Noul has no confidence field. The fetched pages do not state a unit price, so this provider does not invent one. It reports `usage.input_tokens` and `usage.output_tokens` when a response arrives.

The projection keeps metric id, version, meaning, domain, unit, method, reading, status, value, assumptions, and the rubric rule's operator, threshold, upper threshold, unit, method, definition, and recommendation id. It drops raw source, plugin code, the full artifact, and secret-looking keys. A local path anywhere in a string is replaced: POSIX absolute, `~/`, Windows drive, UNC, and `file:` forms. A web URL stays. The key is read from the process environment for the request header and is not written to the cache, the report, or the error text.

`401` and `403` are authentication failures and are not retried. `429`, `529`, and other `5xx` responses retry at most twice, then the advisory status is `unavailable`. A timeout aborts and is `unavailable`. The numerical report is still written. `numerical.pass` is not flipped. Low confidence and a Noul value near one half are `abstain`. A Noul value that disagrees with the verdict of its own rule is `advisory-warning`. An inconclusive or unsupported rule has no verdict to disagree with. A Noul value outside 0 to 1 is a malformed response. A rubric with a repeated rule id or the id `__proto__` fails before the request, because each rule must stay its own question.

The cache key binds the projection, the numerical digest, the rubric version, schema version 1, the adapter version, and the requested model. A pinned model such as `jev-1.13.0` hits only when the stored resolved model is that same id. `jev-latest` is an alias. The cache stores the response model and expires after 24 hours. Changing the requested model or the rubric misses. Cache replay is not a new live call.

The structural contract is `idlekit.jev.advisory.v1` at [docs/schemas/jev.advisory.v1.schema.json](./schemas/jev.advisory.v1.schema.json). The generator also writes [docs/schemas/generated/jev.advisory.v1.schema.json](./schemas/generated/jev.advisory.v1.schema.json). The rules report stays [docs/schemas/judge.output.schema.json](./schemas/judge.output.schema.json). `--provider jev --format json` writes both reports with `_meta`, and its `schemaRef` is [docs/schemas/jev.judge.output.schema.json](./schemas/jev.judge.output.schema.json), which references the other two. The wire samples live in [examples/analysis/jev-wire.json](../examples/analysis/jev-wire.json). Reproduction label is `19`. Ordinary tests use a mock transport. A paid live smoke is not part of this run.

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

The PR #221 review fixes changed the requirement file to sha256 `94072abbc443148a4b7de85e7517b0c22c2c451edda58653d378c2d29c688566`. That revision ran `bun run typecheck`, `bun run test:conformance`, `bun run contracts:check`, and `jev.test.ts`, `judge.test.ts`, and `output-schema.test.ts` from `packages/cli`.

## Graph

Queried with `ttsc-graph` 0.30.4 on `tsconfig.graph.json`, protocol `2025-11-25`, no generation identifier, shutdown 0. Lookup places `adviseWithJev` at `packages/cli/src/lib/evaluation/providers/jev.ts:273`, `projectJevState` at `packages/cli/src/lib/evaluation/providers/jev.ts:92`, `createFetchTransport` at `packages/cli/src/lib/evaluation/providers/jev.ts:151`, and `jevCacheKey` at `packages/cli/src/lib/evaluation/cache.ts:22`. A reverse execution trace (`maxDepth` 2, `maxNodes` 32) of `adviseWithJev` names `runJudge` at `packages/cli/src/commands/judge.ts:45` and the hosts in `jev.test.ts`. The same trace of `projectJevState` names `adviseWithJev`. `graph:check` reported `ok unobserved createPlannerStrategy -> stepOnce (call is PlannerDeps.stepOnce; path hops=0; source default { stepOnce })`. The forward trace listed both declarations and did not add a call edge. Hops 0 is not conformance.
