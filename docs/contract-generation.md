# Contract generation

Korean version: [contract-generation_ko.md](./contract-generation_ko.md)

`TC-05` generates the structural JSON Schema for `ScenarioV1` from the TypeScript type. `validateScenarioV1` stays the runtime semantic gate. The generator does not infer cross-field rules, registry membership, the big-number parser, or safe expressions.

## Command

From the repository root, with Bun `1.4.2` and the `@ttsc/unplugin/bun-register` preload. There is no root `tsconfig.json`. `tools/tsconfig.json` is the nearest project for these scripts. `ScenarioV1` is transformed from `packages/core/tsconfig.json`.

```bash
bun run contracts:check
bun run contracts:generate
```

`contracts:check` is the CI path. It writes nothing under `docs/schemas/generated/`. A byte mismatch exits 1. `contracts:generate` is the only writer. `--write` on the check exits 2.

The installed export is `typia.json.schema` from typia `14.0.6`, OpenAPI `3.1`. `$id` is `https://idlekit.dev/schemas/scenario.v1.schema.json`. The document records the generator name `idlekit.contract-generator`, version `1`, the typia pin, and a sha256 of the relative sources it read. That hash omits timestamps and absolute paths. Sources are hashed with LF line endings, and the check reads the tracked JSON the same way, so a CRLF checkout is not drift.

The file is a JSON Schema 2020-12 document. The generated constraints and `components` sit at its root, so a standard validator can load the file and resolve every `#/components/schemas/...` ref inside it. The generator record is the `idlekitContract` annotation keyword beside them, which validators ignore.

## What is registered

`contractRegistry` in `packages/core/src/scenario/scenarioContract.ts` lists `idlekit.scenario.v1` and `idlekit.analysis.artifact.v1`. `PR-09` appends `idlekit.eta.estimate.v1` from `typia.json.schema<EtaEstimateV1, "3.1">()`. `PR-10` appends `idlekit.reset-cycle.v1` from `typia.json.schema<ResetCycleArtifactV1, "3.1">()`. The analysis entry is `typia.json.schema<AnalysisArtifactV1, "3.1">()`. Do not point that list at every legacy output schema. CLI output schemas under `docs/schemas/*.output.schema.json` stay handwritten. `eta.output.schema.json` stays handwritten. Replay `artifact.v1.schema.json` is not this contract.

`scenario.v1.fields.json` is names, const values, and descriptions copied from the generated schema. Design intent, example numbers, and Korean text stay in authored docs.

## Runtime difference

The schema text sets `additionalProperties` to false. `typia.createValidate<ScenarioV1>()` still allows an unknown key. `validateScenarioV1` allows it too. Do not treat the schema text as a new rejection of existing scenario files.

`stepSec` of `0`, `-1`, or `NaN`, an empty amount, and a clock with no stop condition fail `validateScenarioV1` and pass the structural validator. `meta: null` does the opposite. Those differences are recorded in [the requirement](./requirements/active/typed-contract-generation.md). They are not a migration.

`FiniteUnitRate` shows `tags.Minimum` and `tags.Maximum`. Scenario fields are not branded with those tags.

The validators and the scenario schema are built on first call, not at module load. A plugin loaded by the bundled CLI can import core source without the typia transform. That import does not throw until a contract function runs.

## Four paths

`tools/contract-smoke.ts source` runs the probe with the package preload. `bun test` runs `scenarioContract.test.ts`. `tools/contract-smoke.ts bundle` runs a transformed file outside the repo. `tools/contract-smoke.ts pack` installs the published tarball outside the repo. The first three run from the unit test. The pack row is a separate command.

Node.js and browser runtimes are not part of the v1 compatibility contract.
