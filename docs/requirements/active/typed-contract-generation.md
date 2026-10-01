# Typed contract generation

## One ScenarioV1 schema {#req-tc05-typed-contract-single-source}

Requirement `REQ-TC05-TYPED-CONTRACT-SINGLE-SOURCE`. `TC-05` owns it.

`typedContractSingleSource` is `idlekit.scenario.v1`. The canonical structural type is `ScenarioV1`. `typia` `14.0.6` exports `typia.json.schema`. The call is `typia.json.schema<ScenarioV1, "3.1">()`. The dialect label is `openapi-3.1`. `$id` is `https://idlekit.dev/schemas/scenario.v1.schema.json`.

`contracts:check` generates in memory and compares bytes with `docs/schemas/generated/`. It does not write that directory. `contracts:generate` is the writer. Two generations are byte-identical. Adding a type field changes the schema bytes. A stale tracked file makes `contracts:check` exit 1.

The source hash covers the relative path and sha256 of `types.ts`, `offlinePolicy.ts`, and `scenarioContract.ts`, plus the generator name, version, typia pin, dialect, and registrations. It omits timestamps, the working directory, and absolute paths.

`contractRegistry` lists `idlekit.scenario.v1` only. Later analysis DTOs append there. This change does not migrate every existing DTO. `idlekit.resolved-run-configuration` stays a CLI plan id.

`scenario.v1.fields.json` lists property names, `oneOf` const values, and descriptions already present on the schema. It does not add design intent, example balances, or Korean copy. `policy.mode` is `accumulate` then `drop`.

`FiniteUnitRate` uses `tags.Minimum<0>` and `tags.Maximum<1>`. Those tags are not applied to `ScenarioV1`. The tag brand is not assignable from `number`, so branding `stepSec` would reject existing scenario values.

The generated object schema sets `additionalProperties` to false. `typia.createValidate` still allows an unknown key. That is the installed typia `is` behavior, not a second scenario type.

## Semantic checks stay handwritten {#req-tc05-semantic-validation-retained}

Requirement `REQ-TC05-SEMANTIC-VALIDATION-RETAINED`. `TC-05` owns it.

`semanticValidationRetained` is `validateScenarioV1`. That function remains the runtime gate. The generator does not claim these checks: a missing stop condition, `stepSec > 0`, an empty amount string, model registry membership, the big-number parser, or a safe `untilExpr`.

On the fixed corpus, both gates accept a minimal v1, amount `1e400`, and amount `1aa`. Both reject a missing `unit` and `policy.mode` `"nope"`. `Number("1e400")` is not finite. Neither gate parses that string.

Both gates accept an unknown field. Both accept `Infinity` as `stepSec`, because the handwritten check is `stepSec > 0`. `0`, `-1`, and `NaN` fail the handwritten gate and pass the structural gate. An empty amount and a clock with no stop condition do the same. `meta: null` passes the handwritten gate, because that function does not read `meta`, and fails the structural gate.

`model.params` stays `unknown` on the structural type. A registry schema validates it. A transforming schema can return `value` `{ count: 2 }` from `{ count: "2" }` while the scenario object keeps the raw params. The internal `StandardResult` uses `value` and a string `issues[].path`. Typia uses `data` and `errors`. The adapter has no `vendor` field. It is not the external Standard Schema package. Existing Zod plugin and Bunli flag schemas stay in place.

`validateFiniteUnitRate` accepts `0`, `0.5`, and `1`, and rejects `-0.1`, `1.1`, and `NaN`. That probe is not a scenario field.

There is no RNG. The corpus is the literal object in the test.

## Published validator is transformed {#req-tc05-published-validator-transformed}

Requirement `REQ-TC05-PUBLISHED-VALIDATOR-TRANSFORMED`. `TC-05` owns it.

`publishedValidatorTransformed` is `typia.createValidate<ScenarioV1>`. `validateScenarioStructure` is that call. `parseScenarioStructure` is `typia.json.validateParse<ScenarioV1>`. An unresolved `typia.validate<T>()` is not the scenario path.

Source preload and `bun test` run the validator. `bun tools/contract-smoke.ts bundle` writes one file outside the repository and prints `contract-ok`. That file does not contain `typia.createValidate` or `@ttsc/`. `bun tools/contract-smoke.ts pack` installs the packed core tarball outside the repository and prints `published-ok`. The pack command is not part of `bun test`.

`contracts:check --write` exits 2. A tracked schema whose `schemaVersion` token was edited exits 1.
