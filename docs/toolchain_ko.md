# 툴체인 pin

English version: [toolchain.md](./toolchain.md)

`TC-01`은 개발 compiler host를 pin한다. 패키지 check/emit 스크립트를 `tsc`에서 바꾸지 않는다. 그 전환은 `TC-02`다. 제품 런타임은 Bun이다. 여기의 Node와 Go는 launcher와 native plugin host이며 제품 런타임 지원이 아니다.

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

패키지 `typecheck`와 `build`는 `TC-02` 전까지 `tsc`를 호출한다. 이 pin의 `tsc`는 TypeScript `7.0.2`이며, 실패한 ttsc의 대체 경로가 아니다.

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

## 검증

아래 명령은 Bun `1.3.10`으로 실행했다. `ttsc version`은 `ttsc 0.30.4 (Version 7.0.2)`다. Fixture 입력 hash는 `933e8d6f6e411e2cfef0a4b5ce1a121cc8e00ad647c08d009c2cf632543f5b73`이다. Lockfile sha256은 `c39164595007df4da8710b7fda5f70ccca09d5f9c2f8b8a73d8f4d360d0e137e`다.

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
