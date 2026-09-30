# ADR: Analysis contracts and toolchain baseline

Korean version: [analysis-contracts_ko.md](./analysis-contracts_ko.md)

| | |
|---|---|
| Status | Accepted as the planning contract. No runtime change in this record. |
| Baseline | `main` `265c6ed1dad56e474a9b8acd847be42aaa3faa51` |
| Inventory | [source audit](../implementation/source-audit.md) |
| Date | 2026-09-30 |

Work IDs in this ADR (`PR-00`, `TC-01`, `DX-01`, and the rest) are planning IDs. They are not GitHub pull request numbers.

## Decision

Keep the shipping dependency direction `cli → core → money`. Reuse `SimState`, `Engine`, `Model`, `Action`, `Strategy`, and the model, strategy, and objective registries. Do not add a parallel scenario or policy stack, and do not add a published `@idlekit/analysis` or `@idlekit/ai` package for this track.

Fix simulation correctness and analysis meaning on that stack. Before the first correctness change, land the ttsc toolchain (`TC-01` through `TC-04`) and the conformance harness (`DX-01`). Generate new structural validators before adding analysis DTOs (`TC-05`, before `PR-08`).

This record does not implement those tools. `toolchain:doctor`, `graph:check`, `contracts:check`, `test:conformance`, `idk inspect`, `idk analyze`, `ExecutionPlan`, `RunInstance`, and `AnalyzerRegistry` are names for later work. They are not current APIs.

## Meanings later PRs must share

These words are about committed simulation facts. A planner preview is not one of them.

| Term | Meaning |
|---|---|
| Money | An `Engine` amount plus a unit. It is not a bare JavaScript number. |
| Stock | A quantity held at a specific simulation time, such as the wallet or another declared state quantity. |
| Flow integral | Quantity committed by income or rewards across economic time. A rate is not an integral. |
| Wall time | Time on the session schedule: when the player is present or away. |
| Economic time | Time the economy actually advances after offline cap and decay. |
| Active time | Time inside a session pattern that counts as active play. |
| Goal reached | The first committed state that satisfies a declared goal. |
| Cycle reward | A reward produced by an actual reset transition. |
| Recovery time | Economic time after a reset until a declared recovery target. |

`state.t` today advances with both active steps and offline catch-up. It is not, by itself, a separated wall clock. `PR-06` has to represent wall time and economic time separately when cap or decay shortens the simulated interval.

## Observation status

Unsupported work, missing samples, and a horizon that ends first are different outcomes. Later artifacts use these statuses and do not replace them with `0`, success, or a stable regime:

| Status | When |
|---|---|
| `unsupported` | The model or engine has no capability for the question. |
| `insufficient-data` | The capability exists, and the trace or sample does not. |
| `censored` | The run ended before the goal or event. |

`packages/core/src/sim/analysis/prestigeCycle.ts` sets `stability` from `cycles >= 5` and copies the requested cycle count onto every interval row. That field is not evidence of a steady state. Legacy screens may keep showing it with a warning. New analysis must ignore it.

## Versions and compatibility

- `ScenarioV1.schemaVersion` stays `1`. Existing CLI names and default flags stay.
- `OUTPUT_CONTRACT_VERSION` in `packages/cli/src/io/outputMeta.ts` is `1.4.0`. That value is CLI output metadata. It is not the scenario version, the save/replay version, a future analysis artifact version, or an evaluator rubric version.
- A numeric correction that changes a result is not the same as a breaking JSON shape. Record the cause, the fixture, and the before/after difference in the release note, then update the affected baseline. Do not refresh KPI or snapshot baselines to hide a failure.
- A breaking field type, enum, or meaning needs a new versioned analysis artifact or an explicit opt-in path. Do not add fields that the current output schema rejects. Check `additionalProperties` and consumer fixtures first.
- `generatedAt`, wall-clock duration, and local paths stay out of a reproducible result digest. Add a new field such as `analysisInputHash` when a new digest is required. Do not silently redefine an existing hash.
- `createBreakInfinityEngine` and a custom `Engine` are the large-number paths. `createBreakEternityEngine` throws on every operation. It stays a public placeholder and is outside the supported feature list.
- Seeded stochastic output is reproducible only when the seed, inputs, algorithm version, and model or plugin version match. A Jev response does not promise that.

Free-form JavaScript is not the default path for a new goal, check, or parameter. New paths use a registered id or an existing checked expression path.

Game-specific `vars` fields stay in adapters and fixtures. A reset-cycle model adapts the current `prestige` field. It does not delete that field, and resource observation does not imply multi-currency settlement.

## Baseline update procedure

1. Add a failing fixture that shows the old number and names the source path.
2. Land the fix with that fixture in the same change.
3. Write the cause and the before/after difference into the changeset or release note.
4. Update a golden, KPI, or tune baseline only for values that the fixture explains.

## Toolchain

At the baseline, money and core `typecheck` / `build` call `tsc`. The CLI typecheck calls `tsc`, and the CLI bundle is Bunli. Tests are `bun test`. Nothing in the manifests depends on `ttsc` or `@ttsc/*`.

That changes before `PR-01`:

| Order | Work | Done when |
|---|---|---|
| 0 | `PR-00` | This contract and the source audit |
| 1 | `TC-01` → `TC-02` → `TC-03` / `TC-04` → `DX-01` | Compiler, Bun transform, Evidence, Graph, and conformance tests are actually wired |
| 2 | `TC-05`, before `PR-08` | Generators and a drift gate exist before new analysis DTOs |
| 3 | `PR-01`–`PR-07` | Payment, time bounds, run isolation, observation, session clock, resolved run config |
| 4 | `PR-08`–`PR-14` | Shared metrics, ETA, reset cycles, growth shape, distributions, experiments |
| 5 | `DX-02`–`DX-04` | Analyzer registry, inspect, runtime performance budgets |
| 6 | `PR-17` / `PR-18` | Deterministic checks, then an optional rule judge |
| 7 | `PR-20` | Integration fixtures, docs, packaging, and consumer gates for the selected scope |

`PR-15`, `PR-16`, `PR-19`, and `DX-05` are optional. They do not block the default path. Jev stays an opt-in CLI provider and is a different layer from ttsc Evidence and Graph.

`TC-01` pins one compatible set of `ttsc`, `@ttsc/*`, TypeScript, and typia from release metadata. A failed ttsc install is not patched by calling the old `tsc` or `tsx` path and reporting success. Development Node and Go hosts required by the compiler are in scope for `TC-01`. Shipping Node or browser support is not.

Root `packageManager` is `bun@1.3.10`. `.github/workflows/ci.yml`, `codeql.yml`, `docs-verify.yml`, and `release.yml` pin Bun `1.3.9`. `TC-01` unifies that split. This ADR does not change either pin.

Evidence and Graph gates are not required to merge this document. `TC-03` and `TC-04` turn them on, and they then include the contracts already in the tree. Active requirements live under a future `docs/requirements/active/` tree. This ADR and the implementation plan are not evidence that a feature is done.

## Consequences

- Later PRs can decide inputs, outputs, and compatibility from this file plus the source audit.
- Public API, CLI flags, and saved data stay as they are until a later PR says otherwise.
- `PR-00` does not add a Sampo changeset. No package behavior changes.
