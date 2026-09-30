# Toolchain pins

Korean version: [toolchain_ko.md](./toolchain_ko.md)

`TC-01` pins the development compiler host and does not switch package check or emit scripts off `tsc`. `TC-02` makes that switch. The product runtime stays Bun. Node and Go here are launcher and native-plugin hosts, not supported product runtimes.

## Pins

Registry metadata checked on 2026-09-30. Versions are exact. `ttsc` `@0.30.4` is the current release, and `@ttsc/graph` / `@ttsc/unplugin` peer on `ttsc@^0.30.4`. `@ttsc/evidence` peers on `@ttsc/lint@>0.28.6`.

| Package | Pin | Why this one |
|---|---|---|
| `ttsc`, `@ttsc/lint`, `@ttsc/evidence`, `@ttsc/graph`, `@ttsc/unplugin` | `0.30.4` | One release line. Graph and unplugin peers reject a different minor. |
| `typescript` | `7.0.2` | npm `typescript` package used by tooling and reported by `ttsc version`. Installing it does not turn `ttsc` back into TypeScript 5 `tsc`. |
| `typia` | `14.0.6` | Newest release inside `@ttsc/graph@0.30.4`'s `typia@^14.0.6` range. `15.0.1` is outside that range. The staged `^13.2.0` candidate was not kept. |
| Bun | `1.3.10` | Root `packageManager`. CI workflows use the same pin. |
| Node launcher | `>=22.15.0` | `ttsc@0.30.4` `engines.node`. CI smoke uses `22.23.3`. |
| Publish Node | `22.14.0` | Release workflow only. It is below the ttsc floor and does not run ttsc. |

`fixtures/toolchain/baseline.json` is the read-only `265c6ed` snapshot (`typescript` `^5.8.3`, typia `^9.7.2`, CI Bun `1.3.9`, no ttsc). `fixtures/toolchain/pins.json` is the pin this change checks. A failed `ttsc` install is not retried with `tsc` or `tsx`.

`ttsc version` reports both the ttsc package and the resolved TypeScript-Go version. The native binary and bundled Go live in `@ttsc/<platform>-<arch>`. `TTSC_GRAPH_BINARY` and `TTSC_GO_BINARY` must be unset or point at that package. `toolchain:doctor` rejects any other path. Smoke also clears `TTSC_TTSX_BINARY`.

Bun `1.3.10` reports a Node-compatible `process.version` but `node:module.registerHooks` is missing. `@ttsc/lint` evaluates `lint.config.ts` by spawning `ttsx.js` with `process.execPath` when that path ends in `.js`. Under `bun-register` that executable is Bun, and the evaluation exits 1. `tools/ttsx-under-node` has no `.js` extension, so the lint package spawns it directly and the script `exec`s real `node` on `ttsc/lib/launcher/ttsx.js`. Windows uses `tools/ttsx-under-node.cmd` for the same Node launch. The `bun-preload` fixture sets `TTSC_TTSX_BINARY` to the launcher for the current platform. Product code still runs on Bun. This is not a `tsc` or `tsx` fallback.

## Commands

| Script | What it runs |
|---|---|
| `toolchain:doctor` | Pins, Bun `1.3.10`, Node floor, native binary, bundled Go, and binary overrides |
| `toolchain:prepare` | `ttsc prepare` for the typia and evidence fixtures, then `ttsc cache paths --json` |
| `toolchain:smoke` | Doctor plus the fixture table below |

`TC-02` runs package `typecheck` and money/core `build` through `ttsc`. Public script names stay `typecheck`, `build`, and `test`. `tsc` on this pin is still TypeScript `7.0.2`. A failed `ttsc` run is not retried with `tsc` or `tsx`.

| Program | Config | What it owns |
|---|---|---|
| money check | `packages/money/tsconfig.json` | `src`, including tests. The script passes `--noEmit`. |
| money emit | `packages/money/tsconfig.build.json` | `src` except tests. `target`, `module`, `declaration`, and `sourceMap` stay on `tsconfig.base.json`. |
| core check | `packages/core/tsconfig.json` | `src`, including tests and `concreteValidator.probe.ts`. |
| core emit | `packages/core/tsconfig.build.json` | `src` except tests and `*.probe.ts`. |
| CLI check | `packages/cli/tsconfig.json` | `src`, `scripts`, and `.bunli`. `jsx` is `react-jsx`, `jsxImportSource` is `@opentui/react`, and `DOM` stays on this program only. |
| CLI bundle | `packages/cli/scripts/cli-bundle.ts` | `bunli generate`, then `Bun.build` with `@ttsc/unplugin/bun`. This is not a `ttsc` emit. `@opentui/react` and `@opentui/core` stay external. Inlining `@opentui/core` leaves its asset loader without a file path, and Bun `1.3.10` fails when an uninstalled optional platform package is pulled in. `@idlekit/cli` depends on both packages at `0.4.5` so `dist/main.js` can resolve them. |
| tools | `tsconfig.tools.json` | `tools/**/*.ts`, `noEmit`. Inventory only. |
| examples | `tsconfig.examples.json` | `examples/**/*.ts` and `snippets/**/*.ts`, `noEmit`. Inventory only. | 
| example plugin | `examples/plugins/tsconfig.json` | `custom-econ-plugin.ts`. Nearest project for the plugin file so package preload does not walk to a home `tsconfig.json`. Its private `package.json` keeps `@ttsc/lint` off this program. |
| solution | `tsconfig.solution.json` | `files: []` plus references. Root `typecheck` must not pass this file to `ttsc`. |

There is no root `tsconfig.json`. A root project would auto-attach `@ttsc/lint`, and that config is `TC-03`. Package directories carry `bunfig.toml` with `@ttsc/unplugin/bun-register` for both runtime and `bun test`. Preload follows the process cwd and does not walk upward, so a fixture `bunfig.toml` stays isolated. Root execution of a package source file passes `--preload @ttsc/unplugin/bun-register`. The CLI testkit, `replay:verify`, and doctor’s source re-entry do that when their cwd is the repo root. Each source launch pays for that transform, so `@idlekit/cli` tests use `bun test --timeout 90000` and the multi-command cases allow 180s. `tools/ttsx-under-node` remains the Node launcher for `lint.config.ts` evaluation. Product runtime stays Bun.

Root `overrides` pin `@opentui/core` and `@opentui/react` to `0.4.5`. `@bunli/runtime@0.3.2` declares `0.1.97` for both. Each copy calls `registerEnvVar` on `Symbol.for("@opentui/core/singleton")`. A process that imports the CLI's React package and Bunli's runtime source throws when the second copy registers the same env name. The override keeps one `0.4.5` copy for monorepo source, tests, and the externalized bundle. Published consumers get `@opentui/core` from the CLI dependency, not from the root override.

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
| TSX | emit imports `@opentui/react` | emit that imports `react/jsx-runtime` fails the smoke |

Evidence and Graph are exercised only on this fixture. Repository `evidence:check` and `graph:check` stay absent until `TC-03` and `TC-04`.

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

`transform:smoke` records the four validator paths and the negative checks. Expected nonzero rows are part of the pass: `source-nopreload` 1, `check-type-error` 1 (`TS2322`), `generic-unresolved` 3 (`non-specified generic argument`). The other smoke rows exited 0, including published-artifact run outside the repo, `.d.ts` consumer `ttsc --noEmit`, sourcemap, shebang, lazy review markers, plugin load, and cold/warm `ttsc prepare`. `tsconfig.tools.json` and `tsconfig.examples.json` are inventory programs. Their exit 2 is the missing `TC-03` lint config plus pre-existing errors in those files. They are not in the root `typecheck` script. `bun run build:bin` refuses a standalone executable because `@opentui/core` cannot be inlined. A Linux host was not run for this change. Evidence and Graph stay unconnected.
