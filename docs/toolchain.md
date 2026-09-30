# Toolchain pins

Korean version: [toolchain_ko.md](./toolchain_ko.md)

`TC-01` pins the development compiler host. It does not switch package check or emit scripts off `tsc`. That move is `TC-02`. The product runtime stays Bun. Node and Go here are launcher and native-plugin hosts, not supported product runtimes.

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

Package `typecheck` and `build` scripts still call `tsc` until `TC-02`. `tsc` on this pin is TypeScript `7.0.2`, not a fallback for a failed ttsc run.

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

## Verification

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
