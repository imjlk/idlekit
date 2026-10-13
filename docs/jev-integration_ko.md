# Jev 연동

영문 원문: [jev-integration.md](./jev-integration.md)

`PR-19`는 `idk judge`에 선택적 Jev provider를 더한다. 끝난 분석 artifact의 허용 목록만 보낸다. 밸런스 검사, rules judge, ttsc, Evidence, Graph를 대체하지 않는다. Jev 답은 수치 근거도 아니고 요구사항 검토 승인도 아니다.

기본은 로컬이다. `idk judge --provider rules`, `idk evaluate`, `idk tune`, `idk doctor`, `idk validate`는 `TYPESAFE_API_KEY`가 있어도 네트워크를 호출하지 않는다. `--provider jev`만 연결할 수 있다. `judge`는 그 스위치 뒤에서만 provider 모듈을 불러오므로 다른 명령도 그 모듈을 불러오지 않는다. `--dry-run`은 예정 endpoint와 요청 수만 보이고 보내지 않는다.

2026-10-02에 TypeSafe System One 문서를 다시 확인했다. 호출은 POST `https://api.typesafe.ai/v1/systemone`이고 헤더는 `Authorization: Bearer`와 `Content-Type: application/json`이다. 환경 변수 이름은 `TYPESAFE_API_KEY`다. 요청의 model 필드는 필수다. 문서 예시 요청 모델은 `jev-latest`이고, 문서 예시로 확인된 응답 모델은 `jev-1.13.0`이다. Choice와 Score 답은 `probabilities`와 `confidence`를 가진다. Noul 답은 `noul`만 가진다. 이 모양을 하나의 confidence 필드로 합치지 않는다. `confidence`는 확률 분포의 통계이고 0에서 1 사이다. 게임 밸런스가 맞을 보정된 확률이 아니다. Noul에는 confidence 필드가 없다. 확인한 페이지에 단가가 없어서 이 provider는 가격을 만들지 않는다. 응답이 오면 `usage.input_tokens`와 `usage.output_tokens`를 보고한다.

projection은 metric id, version, meaning, domain, unit, method, reading, status, value, assumptions, 그리고 rubric rule의 operator, threshold, upper threshold, unit, method, definition, recommendation id를 남긴다. 원본 소스, plugin 코드, artifact 전체, secret처럼 보이는 키는 뺀다. amount 읽기는 decimal과 sign을 가진다. 문자열 어디에 있든 로컬 경로는 바꾼다. 깊이와 상관없는 POSIX 절대 경로, `~/`, Windows 드라이브, UNC, `file:` 형태가 그렇고, 공백이 든 이름은 그 경로가 가리키는 파일까지 바꾼다. 웹 URL은 남는다. rule id는 질문 이름으로 보내지므로 경로나 키가 든 id는 요청 전에 거부한다. 키는 요청 헤더를 위해 프로세스 환경에서만 읽고 cache, 보고서, 오류 문장에는 쓰지 않는다.

`401`과 `403`은 인증 실패이고 재시도하지 않는다. `429`, `529`, 그 밖의 `5xx`는 최대 두 번 재시도한 뒤 advisory 상태가 `unavailable`이다. timeout은 중단하고 `unavailable`이다. 수치 보고서는 그대로 남는다. `numerical.pass`는 뒤집히지 않는다. 낮은 confidence와 절반 근처의 Noul은 `abstain`이다. 질문은 기록된 읽기가 자기 rule을 통과하지 못하는지 묻는다. 자기 rule의 verdict와 어긋나는 Noul은 `advisory-warning`이고, 그 경고는 다른 rule의 abstain보다 보고서 상태에서 앞선다. inconclusive나 unsupported rule에는 어긋날 verdict가 없다. 0에서 1 밖의 Noul이나 Score confidence는 잘못된 응답이고, abstain 구간은 0.4부터 0.6까지 양끝을 포함한다. rule id가 겹치거나 `__proto__`인 rubric은 요청 전에 실패한다. rule마다 질문이 하나여야 하기 때문이다.

cache 키는 projection, 수치 digest, rubric 버전, schema 버전 1, adapter 버전, 요청 모델을 묶는다. `jev-1.13.0` 같은 pinned 모델은 저장된 resolved model이 그 id일 때만 hit다. `jev-latest`는 alias다. cache는 응답 모델을 저장하고 24시간 뒤에 만료된다. 요청 모델이나 rubric이 바뀌면 miss다. 쓸 수 없는 cache는 열린 채 실패하고 요청을 다시 보내지 않으며, 검증되지 않는 저장 advisory는 miss다. cache 재생은 새 live 호출이 아니다.

구조 계약은 `idlekit.jev.advisory.v1`이고 경로는 [docs/schemas/jev.advisory.v1.schema.json](./schemas/jev.advisory.v1.schema.json)이다. 생성기는 [docs/schemas/generated/jev.advisory.v1.schema.json](./schemas/generated/jev.advisory.v1.schema.json)도 쓴다. rules 보고서는 [docs/schemas/judge.output.schema.json](./schemas/judge.output.schema.json)으로 남는다. `--provider jev --format json`은 두 보고서와 `_meta`를 함께 쓰고(csv는 거부한다), 그 `schemaRef`는 두 schema를 참조하는 [docs/schemas/jev.judge.output.schema.json](./schemas/jev.judge.output.schema.json)이다. wire 샘플은 [examples/analysis/jev-wire.json](../examples/analysis/jev-wire.json)이다. 재현 라벨은 `19`다. 일반 테스트는 mock transport를 쓴다. 유료 live smoke는 이 실행에 없다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 명령

```bash
idk judge analysis.json --rubric rubric.json --provider rules
idk judge analysis.json --rubric rubric.json --provider jev --dry-run
idk judge analysis.json --rubric rubric.json --provider jev --model jev-1.13.0
```

## 검증

아래 명령은 macOS arm64, Bun 1.4.2, ttsc 0.30.4의 이 worktree에서 실행했다. 요구 파일 sha256 `b5060ae1ac87ca7e71b9ee46e9792f7de2eef8676693edf6096536b3d254bc14`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, `docs:verify`는 unrun이다.

| 명령 | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test --timeout 90000 src/lib/evaluation/providers/jev.test.ts src/commands/judge.test.ts` (`packages/cli`) | 0 |
| `bun run generate` (`packages/cli`) | 0 |
| `bun run generate:check` (`packages/cli`) | 0 |
| `bun run doctor:completions` (`packages/cli`) | 0 |
| `bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts` | 0 |
| `bun run contracts:check` | 0 |
| `bun test --timeout 120000 src/scenario/scenarioContract.test.ts` (`packages/core`) | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run runtime:check` | 0 |
| `bun run public:check` | 0 |

첫 `evidence:check`는 placeholder review 때문에 2로 끝났다. 다음은 inventory가 `export function`을 찾는데 호스트가 `export async function`이라 1로 끝났다. 다시 실행한 값은 0이다. review를 반영한 뒤 `contracts:generate`를 다시 실행했고 `contracts:check`는 0이다. `graph:check`는 `createPlannerStrategy`에서 `stepOnce`까지 hops 0으로 관측하지 않았다.

PR #221 review 수정으로 요구 파일 sha256은 `5dd24a2008d8eb8384d1885d5bf3bd78415ac5a5100604bae02e3b79228edc08`이 됐다. 그 수정에서 `bun run typecheck`, `bun run test:conformance`, `bun run contracts:check`, 그리고 `packages/cli`의 `jev.test.ts`, `judge.test.ts`, `output-schema.test.ts`를 실행했다.

## Graph

커밋 `18f4208`(PR #221 review 수정)에서 `bun tools/graph-query.ts`로 `ttsc-graph` 0.30.4, `tsconfig.graph.json`, protocol `2025-11-25`를 조회했다. 생성 식별자는 없고 shutdown은 0이다. lookup은 `adviseWithJev`를 `packages/cli/src/lib/evaluation/providers/jev.ts:393`, `projectJevState`를 `packages/cli/src/lib/evaluation/providers/jev.ts:139`, `createFetchTransport`를 `packages/cli/src/lib/evaluation/providers/jev.ts:225`, `jevCacheKey`를 `packages/cli/src/lib/evaluation/cache.ts:22`, `runJudge`를 `packages/cli/src/commands/judge.ts:46`에 둔다. `adviseWithJev`의 reverse trace (`maxDepth` 2, `maxNodes` 32)는 `jev.test.ts`의 `boundsHttpFailures`, `separatesCacheIdentity`, `keepsSecretsOutOfRecords`, `keepsNumericalVerdicts`, `staysOptIn`을 가리킨다. `runJudge`는 가리키지 않는다. `judge.ts`가 이제 provider를 동적 `import()`로 불러오고 graph는 그것을 보지 못하므로, 그 연결은 `packages/cli/src/commands/judge.ts`를 읽고 `keepsDefaultCommandsOffNetwork`의 정적 import 탐색으로 확인했다. 처음 re-land 때 `graph:check`는 `ok unobserved createPlannerStrategy -> stepOnce (call is PlannerDeps.stepOnce; path hops=0; source default { stepOnce })`를 보고했다. hops 0은 conformance가 아니다.
