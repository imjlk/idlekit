# 툴체인 pin

English version: [toolchain.md](./toolchain.md)

`TC-01`은 개발 compiler host를 pin하고 패키지 check/emit 스크립트를 `tsc`에서 바꾸지 않는다. `TC-02`가 그 전환을 한다. 제품 런타임은 Bun이다. 여기의 Node와 Go는 launcher와 native plugin host이며 제품 런타임 지원이 아니다.

## Pin

2026-09-30에 registry metadata를 확인했다. 버전은 exact다. `ttsc@0.30.4`가 현재 release이고 `@ttsc/graph`와 `@ttsc/unplugin`은 `ttsc@^0.30.4`를 peer로 둔다. `@ttsc/evidence`는 `@ttsc/lint@>0.28.6`을 peer로 둔다.

| 패키지 | Pin | 이유 |
|---|---|---|
| `ttsc`, `@ttsc/lint`, `@ttsc/evidence`, `@ttsc/graph`, `@ttsc/unplugin` | `0.30.4` | 한 release 선. Graph와 unplugin peer는 다른 minor를 거절한다. |
| `typescript` | `7.0.2` | tooling용 npm `typescript`. `ttsc version`이 이 버전을 보고한다. 이 패키지를 설치해도 `ttsc`가 TypeScript 5 `tsc`로 돌아가지 않는다. |
| `typia` | `14.0.6` | `@ttsc/graph@0.30.4`의 `typia@^14.0.6` 범위 안에서 가장 새 release. `15.0.1`은 범위 밖이다. 미리 올려 둔 `^13.2.0` 후보는 유지하지 않는다. |
| Bun | `1.3.10` | root `packageManager`. CI workflow도 같은 pin이다. |
| Node launcher | `>=22.15.0` | `ttsc@0.30.4`의 `engines.node`. CI smoke는 `22.23.3`을 쓴다. |
| Publish Node | `22.14.0` | release workflow 전용. ttsc 하한보다 낮고 ttsc를 실행하지 않는다. |

`fixtures/toolchain/baseline.json`은 `265c6ed`의 읽기 전용 스냅샷이다 (`typescript` `^5.8.3`, typia `^9.7.2`, CI Bun `1.3.9`, ttsc 없음). `fixtures/toolchain/pins.json`이 이번 pin이다. `ttsc` 설치 실패를 `tsc`나 `tsx`로 다시 시도하지 않는다.

`ttsc version`은 ttsc 패키지와 해석된 TypeScript-Go 버전을 함께 출력한다. native binary와 묶인 Go는 `@ttsc/<platform>-<arch>`에 있다. `TTSC_GRAPH_BINARY`와 `TTSC_GO_BINARY`는 비어 있거나 그 패키지를 가리켜야 한다. 다른 경로는 `toolchain:doctor`가 거절한다. Smoke는 `TTSC_TTSX_BINARY`도 지운다.

Bun `1.3.10`은 Node 호환 `process.version`을 보고하지만 `node:module.registerHooks`는 없다. `@ttsc/lint`는 경로가 `.js`로 끝나면 `process.execPath`로 `ttsx.js`를 실행해 `lint.config.ts`를 평가한다. `bun-register` 아래 그 실행 파일은 Bun이고 평가는 exit 1이다. `tools/ttsx-under-node`에는 `.js` 확장이 없어서 lint 패키지가 그 스크립트를 직접 실행하고, 스크립트는 실제 `node`로 `ttsc/lib/launcher/ttsx.js`를 `exec`한다. `bun-preload` fixture만 `TTSC_TTSX_BINARY`를 그 스크립트로 둔다. 제품 코드는 계속 Bun에서 돈다. 이것은 `tsc`나 `tsx` 폴백이 아니다.

## 명령

| Script | 실행 |
|---|---|
| `toolchain:doctor` | pin, Bun `1.3.10`, Node 하한, native binary, 묶인 Go, binary override |
| `toolchain:prepare` | typia·evidence fixture에 대한 `ttsc prepare`, 이어서 `ttsc cache paths --json` |
| `toolchain:smoke` | doctor와 아래 fixture 표 |

`TC-02`는 패키지 `typecheck`와 money/core `build`를 `ttsc`로 실행한다. 공개 스크립트 이름은 `typecheck`, `build`, `test`로 유지한다. 이 pin의 `tsc`는 TypeScript `7.0.2`다. 실패한 `ttsc`를 `tsc`나 `tsx`로 다시 시도하지 않는다.

| Program | Config | 소유 |
|---|---|---|
| money check | `packages/money/tsconfig.json` | 테스트를 포함한 `src`. 스크립트는 `--noEmit`을 붙인다. |
| money emit | `packages/money/tsconfig.build.json` | 테스트를 제외한 `src`. `target`, `module`, `declaration`, `sourceMap`은 `tsconfig.base.json`에 둔다. |
| core check | `packages/core/tsconfig.json` | 테스트와 `concreteValidator.probe.ts`를 포함한 `src`. |
| core emit | `packages/core/tsconfig.build.json` | 테스트와 `*.probe.ts`를 제외한 `src`. |
| CLI check | `packages/cli/tsconfig.json` | `src`, `scripts`, `.bunli`. `jsx`는 `react-jsx`, `jsxImportSource`는 `@opentui/react`, `DOM`은 이 프로그램만 가진다. |
| CLI bundle | `packages/cli/scripts/cli-bundle.ts` | `bunli generate` 다음 `@ttsc/unplugin/bun`을 붙인 `Bun.build`. `ttsc` emit이 아니다. `@opentui/react`와 `@opentui/core`는 external이다. `@opentui/core`를 묶으면 asset loader가 파일 경로를 받지 못하고, Bun `1.3.10`은 설치되지 않은 optional platform 패키지를 끌어오면 실패한다. `@idlekit/cli`가 둘 다 `0.4.5`에 의존해서 `dist/main.js`가 그 이름을 resolve한다. |
| tools | `tsconfig.tools.json` | `tools/**/*.ts`, `noEmit`. 목록만 유지한다. |
| examples | `tsconfig.examples.json` | `examples/**/*.ts`와 `snippets/**/*.ts`, `noEmit`. 목록만 유지한다. |
| example plugin | `examples/plugins/tsconfig.json` | `custom-econ-plugin.ts`. 패키지 preload가 home `tsconfig.json`까지 올라가지 않도록 이 파일의 nearest project다. private `package.json`이 이 프로그램에 `@ttsc/lint`를 붙이지 않게 한다. |
| solution | `tsconfig.solution.json` | `files: []`와 references. root `typecheck`는 이 파일을 `ttsc`에 넘기지 않는다. |

root `tsconfig.json`은 없다. root project는 `@ttsc/lint`를 자동으로 붙이고, 그 설정은 `TC-03`이다. 패키지 디렉터리의 `bunfig.toml`이 runtime과 `bun test` 모두에 `@ttsc/unplugin/bun-register`를 preload한다. preload는 프로세스 cwd만 보고 상위로 올라가지 않으므로 fixture의 `bunfig.toml`은 격리된다. 패키지 소스를 root에서 실행할 때는 `--preload @ttsc/unplugin/bun-register`를 붙인다. CLI testkit, `replay:verify`, doctor의 source 재진입은 cwd가 repo root일 때 그렇게 한다. source 실행마다 그 변환 비용이 있으므로 `@idlekit/cli` 테스트는 `bun test --timeout 90000`을 쓰고, 명령을 여러 번 띄우는 경우는 180초를 허용한다. `tools/ttsx-under-node`는 `lint.config.ts` 평가용 Node launcher로 남는다. 제품 런타임은 Bun이다.

root `overrides`는 `@opentui/core`와 `@opentui/react`를 `0.4.5`로 고정한다. `@bunli/runtime@0.3.2`는 둘 다 `0.1.97`을 선언한다. 각 복사본이 `Symbol.for("@opentui/core/singleton")`에 `registerEnvVar`를 호출한다. CLI의 React 패키지와 Bunli runtime source를 한 프로세스가 import하면 두 번째 복사본이 같은 env 이름을 등록하다 던진다. override는 monorepo source, 테스트, external bundle이 `0.4.5` 한 벌만 쓰게 한다. 배포 소비자는 root override가 아니라 CLI dependency의 `@opentui/core`를 받는다.

해결되지 않은 `T`의 `typia.validate<T>()`는 `ttsc` 오류다 (`non-specified generic argument`). `typiaStandardSchema<T>()`는 deprecated이며 `TypiaTransformMissingError`를 던진다. `typia.createValidate<Concrete>()`로 만든 함수를 `standardSchemaFromValidate()`에 넘긴다. `ConcreteQuota`, `validateConcreteQuota`, `concreteQuotaSchema`가 concrete probe다. emit된 JS가 `typia`를 import하므로 `@idlekit/core`의 runtime dependency `typia` `14.0.6`은 유지한다. 배포 패키지는 `ttsc`나 `@ttsc/*`에 의존하지 않는다. workspace의 `bun` export는 `src/index.ts`를 가리킨다. `prepack`이 money와 core의 `types`와 `bun`을 `dist`로 바꾸고 `postpack`이 되돌린다. `npm pack`은 패키지 preload가 `tools/`를 변환하지 않도록 manifest tool을 repo root에서 실행한다.

Dependabot은 `ttsc`, `@ttsc/*`, `typia`, `@typia/*`를 한 그룹 PR로 연다. typia 버전 번호는 ttsc와 맞추지 않는다. npm 업데이트는 workspace lockfile이 있는 root만 봐서 패키지 디렉터리의 중복 PR을 만들지 않는다.

## Fixture

`fixtures/toolchain/`은 게임 코드가 아니라 호환성 spike다.

| 검사 | 통과 | 실패 유도 |
|---|---|---|
| compiler | `compiler/`에서 `ttsc --noEmit` | `tsconfig.bad.json`은 nonzero |
| typia | emit된 validator가 `{count:2}`를 허용하고 `{count:"no"}`를 거절 | transformer 없는 raw `bun`은 오류 |
| Evidence | `quotaHost`와 `quotaIsDocumented`가 `docs/quota.md#quota`를 인용 | `@evidence`를 지우면 `[evidence/graph]` 실패 |
| Graph | `quoteBudget`에 대한 MCP `initialize`, `tools/list`, lookup, reverse trace | protocol `1999-01-01`과 빈 프로젝트는 성공이 아님 |
| Bun source | `bun-preload` bunfig가 validator를 실행 | `bun-nopreload`는 실패 |
| emit | plain `bun`이 생성된 JS를 실행하고 `typia.createValidate`는 대체됨 | 남은 `typia.createValidate`나 `@ttsc/*` import는 smoke 실패 |
| TSX | emit이 `@opentui/react`를 import | `react/jsx-runtime` import는 smoke 실패 |

Evidence와 Graph는 이 fixture에서만 확인한다. 저장소 `evidence:check`와 `graph:check`는 `TC-03`과 `TC-04` 전까지 없다.

## TC-01 검증

아래 명령은 Bun `1.3.10`으로 실행했다. `ttsc version`은 `ttsc 0.30.4 (Version 7.0.2)`다. Fixture 입력 hash는 `933e8d6f6e411e2cfef0a4b5ce1a121cc8e00ad647c08d009c2cf632543f5b73`이다. Lockfile sha256은 `3b8640456614474f98e6faff990b85fe2e4274438c42f355ec689bfc278e7ab0`다.

| 명령 | Host | Exit |
|---|---|---|
| `bun run toolchain:doctor` | macOS arm64, Node v26.4.0, 묶인 Go go1.26.8 darwin/arm64, native ttsc sha256 `477cf09bd1d589139306c323dc4ff0971756e0d429f25bd1932a72a59c82e377` | 0 |
| `bun run toolchain:smoke` | macOS arm64, 같은 pin | 0 |
| `docker run --platform linux/amd64 node:22.23.3` 다음 `bun install --frozen-lockfile`과 `bun run toolchain:smoke` | Linux x64, Node v22.23.3, Bun 1.3.10, 묶인 Go go1.26.8 linux/amd64, native ttsc sha256 `381debbd898ef33b340cd04f2287056ec18c9cd4f94701c898803c879d61516c` | 0 |
| `bun tools/analysis-baseline-check.ts` | macOS arm64 | 0 |
| `bun run typecheck` | macOS arm64, `tsc` 7.0.2 | 0 |
| `bun run toolchain:prepare` | | 미실행 |
| `bun run test` | | 미실행 |
| `bun run build` | | 미실행 |

Smoke가 `ttsc prepare`의 cold/warm과 `ttsc cache paths --json`을 이미 실행한다. 단독 `toolchain:prepare` 스크립트는 실행하지 않았다. `docs:verify`, `compat:check`, `replay:verify`도 실행하지 않았다. 실행 중인 Bun이 `1.3.10`이 아니면 doctor는 exit 1이다.

## TC-02 검증

Host는 macOS arm64다. 명령은 `mise exec bun@1.3.10 -- bun ...`으로 실행해서 `PATH`의 Bun이 `1.3.10`이었다. `ttsc version`은 `ttsc 0.30.4 (Version 7.0.2)`다. Node는 `v26.4.0`이다. native ttsc sha256은 `477cf09bd1d589139306c323dc4ff0971756e0d429f25bd1932a72a59c82e377`이다. Lockfile sha256은 `3b8640456614474f98e6faff990b85fe2e4274438c42f355ec689bfc278e7ab0`이다. `packages/core/src/scenario/concreteValidator.ts` sha256은 `68b062b6d912c7a1d95f7f01e2d69f0bca6359b51c09281b0c781c12b5903581`이다. emit된 `packages/core/dist/scenario/concreteValidator.js` sha256은 `06a3ff6ab4610292b6b8df21ea11f4cfd544c2fdd00c2b7c652dd690cf9b2004`다. source map sha256은 `d6bd9afb93aa7659858963ab64f9cc940f1fbb967e7d210582eb5ef82724b8b4`다.

| 명령 | Exit |
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
| `bun run build:bin` | 번들 전에 종료한다. `@opentui/core`는 standalone 실행 파일로 인라인할 수 없다 |
| Linux host | 미실행 |

`transform:smoke`가 validator 네 경로와 음성 검사를 기록한다. 기대한 nonzero도 통과다. `source-nopreload` 1, `check-type-error` 1 (`TS2322`), `generic-unresolved` 3 (`non-specified generic argument`). 나머지 smoke 행은 exit 0이다. repo 밖 published artifact 실행, `.d.ts` consumer `ttsc --noEmit`, sourcemap, shebang, lazy review marker, plugin load, cold/warm `ttsc prepare`가 여기 포함된다. `tsconfig.tools.json`과 `tsconfig.examples.json`은 목록용 프로그램이다. exit 2는 아직 없는 `TC-03` lint config와 그 파일들의 기존 오류다. root `typecheck` 스크립트에 넣지 않는다. `bun run build:bin`은 `@opentui/core`를 인라인할 수 없어서 standalone 실행 파일을 거절한다. Linux host는 이번 변경에서 실행하지 않았다. Evidence와 Graph는 연결하지 않는다.
