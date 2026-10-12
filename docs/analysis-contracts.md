# Analysis contracts

Korean version: [analysis-contracts_ko.md](./analysis-contracts_ko.md)

`PR-08` adds analysis artifact v1 beside ScenarioV1. It does not replace ETA, growth, or CLI `_meta`. `contractVersion` stays `1.4.0`.

## Registries

`ModelAnalysisAdapter` says what one model version can provide: metrics, goals, and whether reset, flow, and advance are known. It is registered by model id and version. `Model` does not grow a required method.

`AnalyzerRegistry` is `DX-02`. It will choose an analysis method. This change does not run one. Flow and advance bodies are later work. A model with no flow or reset capability is `unsupported`. That is not a score of 0 and not a stable state. No adapter at all is `unknown`, which is what `DX-03` inspect can report as not statically known.

## Goals and metrics

The default goals are wallet money, net worth, prestige points, and a milestone key. ETA, experiment, and check adapters call the same predicate. Amounts stay on the `Engine` and cross the wire as decimal strings. Count, time, and ratio values are finite numbers. A missing value is omitted. A real zero stays zero.

Custom units, `vars`, and metric ids are registered by the caller. Core does not hardcode those resource names.

Built-in amount goals report `invalid` when their target or observed amount is NaN or infinite, and omit `reached` and `method`. An absent net worth remains `unsupported`; a requested wallet fallback validates the wallet amount. Custom `met` predicates keep their existing behavior, including a copied built-in goal whose predicate is replaced.

## Artifact

The generated schema is `docs/schemas/generated/analysis.artifact.v1.schema.json`. `contracts:check` compares it and does not rewrite it. Provenance hashes the schema, the algorithm version, and the assumption text, including goal-level assumptions such as a wallet fallback. `linkAnalysisArtifact` puts the artifact next to `_meta`. JSON and Markdown renderers live in core. Markdown prints an amount with its unit.

`validateAnalysisSemantics` checks what the structural schema cannot. A non-ok reading must be labeled `unavailable` and carry no value. A non-ok goal carries neither `reached` nor `method`. `sampleCount` is a nonnegative integer, and `0` stays valid. A metric whose extractor returns a different domain than its definition is read as `invalid`. An amount reading carries no `value`, and a numeric reading carries no `amount`. Versions, `atSec`, and `horizon.sec` must be finite, because JSON writes a nonfinite number as `null`.

Legacy `eta.ts` and `growth.ts` still narrow some amounts with `toNumber` or `Number`. Those calls are classified as estimate paths, not as the artifact contract. This change does not ban every finite conversion.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Verification

The contract fixture has no RNG. State values are literals. These commands were run on macOS arm64 with Bun `1.4.2` from this worktree.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun run typecheck` | 0 |
| `bun run test` | 0 |
| `bun run build` | 0 |
| `bun run runtime:check` | 0 |
| `bun run compat:check` | 0 |
| `bun run replay:verify` | 0 |
| `bun run docs:verify:quick` | 0 |
| `bun run templates:check` | 0 |
| `bun run contracts:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run --cwd packages/cli generate:check` | 0 |
| `bun run --cwd packages/cli doctor:completions` | 0 |
| `bun run readme:smoke` | 0 |
| `bun run install:smoke` | 0 |
| `bun run review:smoke` | 0 |
| `bun test --timeout 120000 src/sim/analysis/analysisContract.test.ts` in `packages/core` | 0 |
| `bun test --cwd packages/cli --timeout 120000 src/io/analysisArtifact.test.ts` | 0 |

Not run: `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `test:conformance:extended`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, a Linux host, and CI. Graph caller notes are in [development-graph.md](./development-graph.md).
