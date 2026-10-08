# Toolchain pins

Korean version: [toolchain_ko.md](./toolchain_ko.md)

`TC-01` pins the development compiler host and does not switch package check or emit scripts off `tsc`. `TC-02` makes that switch. The product runtime stays Bun. Node and Go here are launcher and native-plugin hosts, not supported product runtimes.

## Pins

Registry metadata checked on 2026-10-08. Versions are exact. `ttsc` `@0.30.4` is the current release, and `@ttsc/graph` / `@ttsc/unplugin` peer on `ttsc@^0.30.4`. `@ttsc/evidence` peers on `@ttsc/lint@>0.28.6`.

| Package | Pin | Why this one |
|---|---|---|
| `ttsc`, `@ttsc/lint`, `@ttsc/evidence`, `@ttsc/graph`, `@ttsc/unplugin` | `0.30.4` | One release line. Graph and unplugin peers reject a different minor. |
| `typescript` | `7.0.2` | npm `typescript` package used by tooling and reported by `ttsc version`. Installing it does not turn `ttsc` back into TypeScript 5 `tsc`. |
| `typia` | `14.0.6` | Newest release inside `@ttsc/graph@0.30.4`'s `typia@^14.0.6` range. `15.1.0` is outside that range. The staged `^13.2.0` candidate was not kept. |
| Bun | `1.4.2` | Root `packageManager`. CI workflows use the same pin. |
| Node launcher | `>=22.15.0` | `ttsc@0.30.4` `engines.node`. CI smoke uses `26.11.1`. |
| Publish Node | `26.11.1` | Release workflow. Same Node as CI, because `publish:gate` and package prepack run ttsc. |

`fixtures/toolchain/baseline.json` is the read-only `265c6ed` snapshot (`typescript` `^5.8.3`, typia `^9.7.2`, CI Bun `1.3.9`, no ttsc). `fixtures/toolchain/pins.json` is the pin this change checks. A failed `ttsc` install is not retried with `tsc` or `tsx`.

`ttsc version` reports both the ttsc package and the resolved TypeScript-Go version. The native binary and bundled Go live in `@ttsc/<platform>-<arch>`. `TTSC_GRAPH_BINARY` and `TTSC_GO_BINARY` must be unset or point at that package. `toolchain:doctor` rejects any other path. Smoke also clears `TTSC_TTSX_BINARY`.

Bun `1.4.2` reports a Node-compatible `process.version` but `node:module.registerHooks` is missing. `@ttsc/lint` evaluates `lint.config.ts` by spawning `ttsx.js` with `process.execPath` when that path ends in `.js`. Under `bun-register` that executable is Bun, and the evaluation exits 1. `tools/ttsx-under-node` has no `.js` extension, so the lint package spawns it directly and the script `exec`s real `node` on `ttsc/lib/launcher/ttsx.js`. On Windows, `TTSC_TTSX_BINARY` uses Bun’s installed `node_modules/.bin/ttsx.exe` shim. Node can spawn that executable directly; `.cmd` launchers require a shell and fail when spawned directly. The `bun-preload` fixture sets `TTSC_TTSX_BINARY` to the launcher for the current platform. Product code still runs on Bun. This is not a `tsc` or `tsx` fallback.

## Commands

The `bun-preload` transform fixture owns a private package manifest with only the pinned `typia` dependency. The negative conformance runner copies that boundary with the source and tsconfig. Without it, ttsc discovers the repository's lint/evidence plugins too; in `0.30.4` their unrelated missing-path host proofs can reject an otherwise valid transform generation. The positive control still executes Bun's real typia validator against valid and invalid values, and the missing-transform, evidence, and graph controls remain separate required checks. A Bun `directory mismatch` warning can occur on a successful transform and is not itself the failure verdict. Each invocation uses a fresh temporary directory, so an interrupted run or a reused PID cannot cause another run's project to be deleted.

| Script | What it runs |
|---|---|
| `toolchain:doctor` | Pins, Bun `1.4.2`, Node floor, native binary, bundled Go, and binary overrides |
| `toolchain:prepare` | `ttsc prepare` for the typia and evidence fixtures, then `ttsc cache paths --json` |
| `toolchain:smoke` | Doctor plus the fixture table below |

`TC-02` runs package `typecheck` and money/core `build` through `ttsc`. Public script names stay `typecheck`, `build`, and `test`. `tsc` on this pin is still TypeScript `7.0.2`. A failed `ttsc` run is not retried with `tsc` or `tsx`.

| Program | Config | What it owns |
|---|---|---|
| money check | `packages/money/tsconfig.json` | `src`, including tests. The script passes `--noEmit`. |
| money emit | `packages/money/tsconfig.build.json` | `src` except tests. `target`, `module`, `declaration`, and `sourceMap` stay on `tsconfig.base.json`. |
| core check | `packages/core/tsconfig.json` | `src`, including tests and `concreteValidator.probe.ts`. |
| core emit | `packages/core/tsconfig.build.json` | `src` except tests and `*.probe.ts`. |
| CLI check | `packages/cli/tsconfig.json` | Plain TypeScript in `src` and `scripts`; no React or JSX runtime dependency. |
| CLI bundle | `packages/cli/scripts/cli-bundle.ts` | `Bun.build` with `@ttsc/unplugin/bun`; supports JS bundles and the `build:bin` standalone executable. |
| tools | `tsconfig.tools.json` | `tools/**/*.ts`, `noEmit`. Inventory only. |
| examples | `tsconfig.examples.json` | `examples/**/*.ts` and `snippets/**/*.ts`, `noEmit`. Inventory only. | 
| example plugin | `examples/plugins/tsconfig.json` | `custom-econ-plugin.ts`. Nearest project for the plugin file so package preload does not walk to a home `tsconfig.json`. Its private `package.json` keeps `@ttsc/lint` off this program. |
| evidence | `tsconfig.evidence.json` | `TC-03` gate. `@ttsc/lint` loads `lint.config.ts`. `@ttsc/evidence` is a lint contributor, not a compiler plugin. |
| format | `tsconfig.format.json` | New evidence tools only. `format.severity` is `"error"`. |
| graph | `tsconfig.graph.json` | `noEmit` program for money, core, CLI, and tools. `@ttsc/lint` is `enabled: false`. |
| solution | `tsconfig.solution.json` | `files: []` plus references. Root `typecheck` must not pass this file to `ttsc`. |

There is no root `tsconfig.json`. A root project would auto-attach `@ttsc/lint`, and that config is `TC-03`. Package directories carry `bunfig.toml` with `@ttsc/unplugin/bun-register` for both runtime and `bun test`. Preload follows the process cwd and does not walk upward, so a fixture `bunfig.toml` stays isolated. Root execution of a package source file passes `--preload @ttsc/unplugin/bun-register`. The CLI testkit and doctor’s source re-entry still pass that preload when the entry is TypeScript and the cwd is the repo root. `@idlekit/cli`'s `test` script bundles the CLI once with `ttsc` into `packages/cli/.test-bundle/` and sets `IDLEKIT_CLI_ENTRY`, so the suite runs that JavaScript instead of building a new program on every command. Direct `bun test` of a TypeScript entry still pays for the transform. The package timeout stays `90000`, and the multi-command cases still allow 180s. `replay:verify`, `kpi:report`, and `docs:verify` run `packages/cli/dist/main.js` when `IDLEKIT_CLI_DIST=1` and that file exists. Otherwise they reuse `.test-bundle/main.js`, building it on first use. The bundled process points `--config` at `tools/bundled-cli-bunfig.toml` so the package preload does not rebuild the program. `tools/ttsx-under-node` remains the Node launcher for `lint.config.ts` evaluation. Product runtime stays Bun.

Gunshi handles CLI dispatch, nested commands, help, completion, and typo suggestions. Wizards use Clack; review commands are report aliases defaulting to Markdown. Bunli, OpenTUI, React, image previews, and their overrides have been removed.

`typia.validate<T>()` with an unresolved `T` is a `ttsc` error (`non-specified generic argument`). `typiaStandardSchema<T>()` is deprecated and throws `TypiaTransformMissingError`. Call `typia.createValidate<Concrete>()` and pass that function to `standardSchemaFromValidate()`. `ConcreteQuota`, `validateConcreteQuota`, and `concreteQuotaSchema` are the concrete probe. Emitted JS still imports `typia`, so `@idlekit/core` keeps `typia` `14.0.6` as a runtime dependency. Published packages do not depend on `ttsc` or `@ttsc/*`. Workspace `bun` exports point at `src/index.ts`; `prepack` rewrites money and core `types` and `bun` to `dist` and `postpack` restores them. `npm pack` runs the manifest tool from the repo root so the package preload does not transform `tools/`.

Dependabot opens one grouped pull request for `ttsc`, `@ttsc/*`, `typia`, and `@typia/*`. typia stays on its own version line. npm updates are rooted at the workspace lockfile so package directories do not open a second pull request.

## Fixture

`fixtures/toolchain/` is the compatibility spike, not the game. Positive and induced-failure rows:

| Check | Pass | Induced failure |
|---|---|---|
| compiler | `ttsc --noEmit` on `compiler/` | `tsconfig.bad.json` exits nonzero |
| typia | emitted validator accepts `{count:2}` and rejects `{count:"no"}` | raw `bun` without the transformer errors |
| Evidence | `quotaHost` and `quotaIsDocumented` cite `docs/quota.md#quota` | deleting `@evidence` makes `[evidence/graph]` fail |
| Graph | MCP `initialize`, `tools/list`, lookup, and reverse trace on `quoteBudget` | protocol `1999-01-01` and the empty project do not count as success |
| Bun source | `bun-preload` bunfig runs the validator | `bun-nopreload` fails |
| emit | plain `bun` runs emitted JS; `typia.createValidate` is replaced | a leftover `typia.createValidate` or `@ttsc/*` import fails the smoke |
| TSX | emit uses the local `h` factory | retained React/OpenTUI runtime imports fail the smoke |

The toolchain fixture still exercises Evidence and Graph in isolation. `TC-03` adds repository `evidence:check` and `evidence:smoke`. `TC-04` adds `graph:check` for the repository program. `DX-01` adds `test:conformance`. `contracts:generate` and `contracts:check` stay absent.

## Evidence scope

Evidence and the inventory catch drift by an author who is not trying to fool them: a deleted citation, a renamed export, a test that is no longer registered or no longer runs, a mislabeled requirement ID, a shrunken baseline, a disabled rule. Honest code that the gate rejects is a bug in the gate.

They are not a sandbox for test code written to deceive the gate. A test runs with the developer's rights. It can evaluate code through `node:vm` or `Reflect`, start a detached process, or rewrite its own reporter output. Code review of the test source covers that case. The source lock stays as a best-effort guard, not a security boundary. A finding that needs adversarial test code is out of scope for `evidence:check`.


2026-10-08 update: use Bun `1.4.2`, CI and publish Node `26.11.1`, and npm `12.2.0`. Refresh Zod, AJV, YAML, and the Bun/Node types. Gunshi, its official plugins, Clack, the ttsc family, and TypeScript are already current. Keep typia `14.0.6` inside Graph’s `typia@^14.0.6` range. Windows tools prefer Bun’s `.exe` shims. The TC verification records below retain their historical versions.

## TC-01 verification

Commands below used Bun `1.3.10`. `ttsc version` was `ttsc 0.30.4 (Version 7.0.2)`. Fixture input hash `933e8d6f6e411e2cfef0a4b5ce1a121cc8e00ad647c08d009c2cf632543f5b73`. Lockfile sha256 `3b8640456614474f98e6faff990b85fe2e4274438c42f355ec689bfc278e7ab0`.

| Command | Host | Exit |
|---|---|---|
| `bun run toolchain:doctor` | macOS arm64, Node v26.4.0, bundled Go go1.26.8 darwin/arm64, native ttsc sha256 `477cf09bd1d589139306c323dc4ff0971756e0d429f25bd1932a72a59c82e377` | 0 |
| `bun run toolchain:smoke` | macOS arm64, same pins | 0 |
| `docker run --platform linux/amd64 node:22.23.3`, then `bun install --frozen-lockfile` and `bun run toolchain:smoke` | Linux x64, Node v22.23.3, Bun 1.3.10, bundled Go go1.26.8 linux/amd64, native ttsc sha256 `381debbd898ef33b340cd04f2287056ec18c9cd4f94701c898803c879d61516c` | 0 |
| `bun tools/analysis-baseline-check.ts` | macOS arm64 | 0 |
| `bun run typecheck` | macOS arm64, `tsc` 7.0.2 | 0 |
| `bun run toolchain:prepare` | | unrun |
| `bun run test` | | unrun |
| `bun run build` | | unrun |

Smoke already runs `ttsc prepare` cold and warm and `ttsc cache paths --json`. The standalone `toolchain:prepare` script was not run. `docs:verify`, `compat:check`, and `replay:verify` were not run. A doctor process whose Bun is not `1.3.10` exits 1.

## TC-02 verification

Host is macOS arm64. Commands ran as `mise exec bun@1.3.10 -- bun ...` so the Bun on `PATH` was `1.3.10`, not the newer default shim. `ttsc version` was `ttsc 0.30.4 (Version 7.0.2)`. Node was `v26.4.0`. Native ttsc sha256 `477cf09bd1d589139306c323dc4ff0971756e0d429f25bd1932a72a59c82e377`. Lockfile sha256 `3b8640456614474f98e6faff990b85fe2e4274438c42f355ec689bfc278e7ab0`. `packages/core/src/scenario/concreteValidator.ts` sha256 `68b062b6d912c7a1d95f7f01e2d69f0bca6359b51c09281b0c781c12b5903581`. Emitted `packages/core/dist/scenario/concreteValidator.js` sha256 `06a3ff6ab4610292b6b8df21ea11f4cfd544c2fdd00c2b7c652dd690cf9b2004`. Its source map sha256 `d6bd9afb93aa7659858963ab64f9cc940f1fbb967e7d210582eb5ef82724b8b4`.

| Command | Exit |
|---|---|
| `bun run toolchain:doctor` | 0 |
| `bun run typecheck` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/analysis-baseline-check.ts` | 0 |
| `bun run transform:smoke` | 0 |
| `bun run test` | 0 (money 20, core 86, cli 115) |
| `bun run build` | 0 |
| `bun run install:smoke` | 0 |
| `bun run readme:smoke` | 0 |
| `bun run review:smoke` | 0 |
| `bun run compat:check` | 0 |
| `bun run replay:verify` | 0 |
| `bunx ttsc -p tsconfig.tools.json --noEmit` | 2 |
| `bunx ttsc -p tsconfig.examples.json --noEmit` | 2 |
| `bunx ttsc -p examples/plugins/tsconfig.json --noEmit` | 0 |
| `bun run build:bin` | exits before bundling. A standalone executable cannot inline `@opentui/core` |
| Linux host | unrun |

`transform:smoke` records the four validator paths and the negative checks. Expected nonzero rows are part of the pass: `source-nopreload` 1, `check-type-error` 1 (`TS2322`), `generic-unresolved` 3 (`non-specified generic argument`). The other smoke rows exited 0, including published-artifact run outside the repo, `.d.ts` consumer `ttsc --noEmit`, sourcemap, shebang, lazy review markers, plugin load, and cold/warm `ttsc prepare`. `tsconfig.tools.json` and `tsconfig.examples.json` are inventory programs. `TC-03` sets `@ttsc/lint` `enabled: false` there so the repository evidence graph is not applied to a Program that does not contain its hosts. `bun run build:bin` refuses a standalone executable because `@opentui/core` cannot be inlined. A Linux host was not run for that change.

## TC-03 verification

Host is macOS arm64. Commands ran as `mise exec bun@1.3.10 -- bun ...`. `ttsc version` was `ttsc 0.30.4 (Version 7.0.2)`. `evidence:check` prints active-doc and config sha256 values and `ttsc cache paths --json` for `tsconfig.evidence.json` (`projectRoot` is this repository, plugin cache `node_modules/.cache/ttsc/plugins`).

| Command | Exit |
|---|---|
| `bun run typecheck` | 0 |
| `bun run evidence:check` | 0 |
| `bun run evidence:smoke` | 0 (42 rows) |
| `bun run format:check` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/analysis-baseline-check.ts` | 0 |
| `bun test src/scenario/concreteValidator.test.ts` in `packages/core` | 0 (3 pass) |
| `bun run graph:check` | unrun on this change (`TC-04` runs it) |
| Linux host | unrun |

## TC-04 verification

Host is macOS arm64. Commands ran as `mise exec bun@1.3.10 -- bun ...` on commit `3e16237ec6e5b3c9a5ab6e35e3bf962ab97eef9f`. `@ttsc/graph` and `ttsc` were `0.30.4`. The MCP handshake reported protocol `2025-11-25` and server `ttsc-graph 0.30.4`. Results had no generation identifier, so the scratch fixture was checked again in a fresh process. The same open session reported `quotaHost` as `(): 4` after the signature edit. Input sha256: `tsconfig.graph.json` `f4c53cefd70090c4437eb4593d837fff966570400dfb663c3b16b4e68035928e`, `tools/graph-query.ts` `fb713ee8f165a5b3d502b3ce0753ad759cd81269f3ee125c846cc6bb1d995114`, `tools/graph-preflight.ts` `fe73e2c2a70a314085183d1054fcf46aba12d462c4982b6dc341071caaef953d`.

| Command | Exit |
|---|---|
| `bun run graph:check` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/analysis-baseline-check.ts` | 0 |
| `bun run typecheck` | unrun |
| `bun run format:check` | unrun |
| `bun run test` | unrun |
| Linux host | unrun |
| CI `graph:check` | unrun |

`graph:check` resolved `runScenario` to `packages/core/src/sim/simulator.ts:6`, `stepOnce` to `packages/core/src/sim/step.ts:50`, `compileScenario` to `packages/core/src/scenario/compile.ts:490`, and `tickMoney` to `packages/money/src/policy/tickMoney.ts:8`. The tour payload includes those `runScenario` and `stepOnce` spans. Forward and reverse execution traces connect `runScenario` and `stepOnce`. A reverse trace from `runScenario` cites `packages/cli/src`. `createPlannerStrategy` is `packages/core/src/sim/strategy/planner.ts:189`. The path to `stepOnce` has no hops: the call is `d.stepOnce` on `PlannerDeps`, and the default `{ stepOnce }` is read from the `createPlannerStrategy` declaration, not a graph edge. Scratch rename, signature change, and `@evidence` target change were visible. Details are in [Development graph](./development-graph.md).

`evidence:smoke` expects nonzero for deleted citations, a missing anchor, a new active heading, a stale review after a markdown edit on the same cache, a stale review after the cited function body changes, a forbidden `@evidenceExclude`, an unregistered named test, a false assertion, an empty glob, an empty Program, coverage shrinkage without an approval, and `format.severity` `"error"`. The false-assertion row is exit 0 from `ttsc` and nonzero from `bun test`. Evidence does not decide that assertion. Inventory is the project check that the named test actually ran. `singular` is off. `evidence/documented` and `evidence/todo` are on for `fixtures/evidence/base` only, because this lint loader accepts one config object and a `files` filter cannot scope contributor options separately from `evidence/graph`.
