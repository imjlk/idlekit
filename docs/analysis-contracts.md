# Analysis contracts

Korean version: [analysis-contracts_ko.md](./analysis-contracts_ko.md)

`PR-08` adds analysis artifact v1 beside ScenarioV1. It does not replace ETA, growth, or CLI `_meta`. `contractVersion` stays `1.4.0`.

## Registries

`ModelAnalysisAdapter` says what one model version can provide: metrics, goals, and whether reset, flow, and advance are known. It is registered by model id and version. `Model` does not grow a required method.

`AnalyzerRegistry` is `DX-02`. It will choose an analysis method. This change does not run one. Flow and advance bodies are later work. A model with no flow or reset capability is `unsupported`. That is not a score of 0 and not a stable state. No adapter at all is `unknown`, which is what `DX-03` inspect can report as not statically known.

## Goals and metrics

The default goals are wallet money, net worth, prestige points, and a milestone key. ETA, experiment, and check adapters call the same predicate. Amounts stay on the `Engine` and cross the wire as decimal strings. Count, time, and ratio values are finite numbers. A missing value is omitted. A real zero stays zero.

Custom units, `vars`, and metric ids are registered by the caller. Core does not hardcode those resource names.

## Artifact

The generated schema is `docs/schemas/generated/analysis.artifact.v1.schema.json`. `contracts:check` compares it and does not rewrite it. Provenance hashes the schema, the algorithm version, and the assumption text. `linkAnalysisArtifact` puts the artifact next to `_meta`. JSON and Markdown renderers live in core.

Legacy `eta.ts` and `growth.ts` still narrow some amounts with `toNumber` or `Number`. Those calls are classified as estimate paths, not as the artifact contract. This change does not ban every finite conversion.

Node.js and browser runtimes are not part of the v1 compatibility contract.
