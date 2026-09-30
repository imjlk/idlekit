# ADR: 분석 계약과 툴체인 기준

English version: [analysis-contracts.md](./analysis-contracts.md)

| | |
|---|---|
| 상태 | 계획 계약으로 채택. 이 기록은 런타임을 바꾸지 않는다. |
| 기준 | `main` `265c6ed1dad56e474a9b8acd847be42aaa3faa51` |
| 인벤토리 | [소스 감사](../implementation/source-audit_ko.md) |
| 날짜 | 2026-09-30 |

이 ADR의 `PR-00`, `TC-01`, `DX-01` 같은 번호는 계획 ID다. GitHub pull request 번호가 아니다.

## 결정

배포 의존 방향은 `cli → core → money`를 유지한다. `SimState`, `Engine`, `Model`, `Action`, `Strategy`와 model, strategy, objective registry를 재사용한다. 병렬 scenario/policy 체계를 만들지 않고, 이 트랙에서 `@idlekit/analysis`나 `@idlekit/ai` 배포 패키지를 추가하지 않는다.

그 스택 위에서 시뮬레이션 정확성과 분석 의미를 고친다. 첫 정확성 수정 전에 ttsc 툴체인(`TC-01`–`TC-04`)과 conformance harness(`DX-01`)를 둔다. 분석 DTO를 늘리기 전에 구조 validator를 생성한다(`TC-05`, `PR-08` 이전).

이 기록은 그 도구를 구현하지 않는다. `toolchain:doctor`, `graph:check`, `contracts:check`, `test:conformance`, `idk inspect`, `idk analyze`, `ExecutionPlan`, `RunInstance`, `AnalyzerRegistry`는 이후 작업의 이름이다. 현재 API가 아니다.

## 이후 PR이 공유할 의미

아래 단어는 커밋된 시뮬레이션 사실에 대한 것이다. planner preview는 여기에 들어가지 않는다.

| 용어 | 의미 |
|---|---|
| 금액 | `Engine` 양과 단위. JavaScript number 자체가 아니다. |
| 보유량 | 특정 시뮬레이션 시각의 수량. 지갑이나 선언된 다른 상태 수량. |
| 누적 획득량 | 경제 시간 동안 수입이나 보상으로 커밋된 양. 속도(rate)가 아니다. |
| 벽시계 시간 | 세션 일정의 시간. 플레이어가 접속 중이거나 떠나 있는 시간. |
| 경제 시간 | 오프라인 상한과 감쇠 이후 경제가 실제로 진행한 시간. |
| 활성 시간 | 세션 패턴 안에서 활성 플레이로 세는 시간. |
| 목표 도달 | 선언된 목표를 만족하는 첫 커밋 상태. |
| 회차 보상 | 실제 reset 전이가 만든 보상. |
| 복구 시간 | reset 이후 선언된 복구 목표까지 걸린 경제 시간. |

현재 `state.t`는 활성 step과 오프라인 catch-up이 함께 진행시킨다. 그 값만으로 벽시계가 분리되어 있지는 않다. 상한이나 감쇠가 시뮬레이션 구간을 줄일 때 벽시계 시간과 경제 시간을 나누는 작업은 `PR-06`이다.

## 관측 상태

지원하지 않는 질문, 샘플 부족, 구간이 먼저 끝난 경우는 서로 다른 결과다. 이후 artifact는 이 상태를 쓰고, 그 자리를 `0`, 성공, 안정 regime으로 바꾸지 않는다.

| 상태 | 조건 |
|---|---|
| `unsupported` | 모델이나 엔진에 그 질문을 답할 capability가 없다. |
| `insufficient-data` | capability는 있고, trace나 샘플이 없다. |
| `censored` | 목표나 이벤트 전에 실행이 끝났다. |

`packages/core/src/sim/analysis/prestigeCycle.ts`의 `stability`는 `cycles >= 5`로 정해지고, 요청한 cycle 수가 모든 interval 행에 복사된다. 이 필드는 정상상태의 증거가 아니다. 기존 화면은 경고와 함께 유지할 수 있다. 새 분석은 이 값을 쓰지 않는다.

## 버전과 호환

- `ScenarioV1.schemaVersion`은 `1`을 유지한다. 기존 CLI 이름과 기본 flag도 유지한다.
- `packages/cli/src/io/outputMeta.ts`의 `OUTPUT_CONTRACT_VERSION`은 `1.4.0`이다. 이 값은 CLI 출력 metadata다. scenario 버전, save/replay 버전, 미래의 분석 artifact 버전, evaluator rubric 버전이 아니다.
- 결과 숫자가 바뀌는 교정과 JSON 형태가 깨지는 변경은 다르다. 원인, fixture, 전후 차이를 릴리스 노트에 남기고 해당 baseline을 갱신한다. 실패를 숨기려고 KPI나 snapshot baseline을 통째로 갈아끼우지 않는다.
- 필드 타입, enum, 의미가 깨지면 새 버전의 분석 artifact나 명시적 opt-in 경로가 필요하다. 현재 출력 schema가 거부하는 필드를 그냥 넣지 않는다. 먼저 `additionalProperties`와 consumer fixture를 확인한다.
- `generatedAt`, 벽시계 소요시간, 로컬 경로는 재현 가능한 결과 digest 밖에 둔다. 새 digest가 필요하면 `analysisInputHash` 같은 새 필드를 둔다. 기존 hash를 조용히 다시 정의하지 않는다.
- 큰 수의 실제 경로는 `createBreakInfinityEngine`과 사용자 `Engine`이다. `createBreakEternityEngine`은 모든 연산에서 throw한다. public placeholder로 남으며 지원 기능 목록에 넣지 않는다.
- seeded stochastic 결과는 seed, 입력, 알고리즘 버전, 모델 또는 plugin 버전이 같을 때 재현된다. Jev 응답은 그 수준의 결정성을 약속하지 않는다.

새 goal, check, parameter의 기본 경로로 임의의 JavaScript를 실행하지 않는다. 새 경로는 등록된 id나 이미 검사되는 표현식 경로를 쓴다.

게임별 `vars` 필드는 adapter와 fixture에 둔다. reset-cycle 모델은 현재 `prestige` 필드를 적응시킨다. 그 필드를 지우지 않으며, 자원 관측이 다중 화폐 결제를 뜻하지 않는다.

## Baseline 갱신 절차

1. 이전 숫자와 소스 경로를 보여주는 실패 fixture를 추가한다.
2. 그 fixture와 수정을 같은 변경에 넣는다.
3. 원인과 전후 차이를 changeset 또는 릴리스 노트에 쓴다.
4. fixture가 설명하는 값만 golden, KPI, tune baseline에서 갱신한다.

## 툴체인

기준 시점에서 money와 core의 `typecheck` / `build`는 `tsc`를 호출한다. CLI typecheck도 `tsc`이고 CLI 번들은 Bunli다. 테스트는 `bun test`다. manifest는 `ttsc`나 `@ttsc/*`에 의존하지 않는다.

이 구성은 `PR-01` 전에 바뀐다.

| 순서 | 작업 | 끝나는 조건 |
|---|---|---|
| 0 | `PR-00` | 이 계약과 소스 감사 |
| 1 | `TC-01` → `TC-02` → `TC-03` / `TC-04` → `DX-01` | compiler, Bun 변환, Evidence, Graph, conformance 테스트가 실제로 연결됨 |
| 2 | `TC-05`, `PR-08` 전 | 새 분석 DTO 전에 generator와 drift gate |
| 3 | `PR-01`–`PR-07` | 결제, 시간 경계, 실행 격리, 관측, 세션 시계, resolved run config |
| 4 | `PR-08`–`PR-14` | 공통 지표, ETA, reset cycle, 성장 형태, 분포, 실험 |
| 5 | `DX-02`–`DX-04` | analyzer registry, inspect, 런타임 성능 예산 |
| 6 | `PR-17` / `PR-18` | 결정적 check, 그다음 선택적 rule judge |
| 7 | `PR-20` | 선택한 범위의 통합 fixture, 문서, 패키징, consumer gate |

`PR-15`, `PR-16`, `PR-19`, `DX-05`는 선택이다. 기본 경로를 막지 않는다. Jev는 opt-in CLI provider이며 ttsc Evidence/Graph와 다른 계층이다.

`TC-01`은 release metadata에서 호환되는 `ttsc`, `@ttsc/*`, TypeScript, typia 조합 하나를 pin한다. ttsc 설치 실패를 기존 `tsc`나 `tsx`로 통과시키지 않는다. compiler가 요구하는 개발용 Node와 Go host는 `TC-01` 범위다. 제품 Node/브라우저 지원은 범위가 아니다.

root `packageManager`는 `bun@1.3.10`이다. `.github/workflows/ci.yml`, `codeql.yml`, `docs-verify.yml`, `release.yml`은 Bun `1.3.9`를 pin한다. 이 차이는 `TC-01`에서 맞춘다. 이 ADR은 어느 쪽 pin도 바꾸지 않는다.

Evidence와 Graph gate는 이 문서를 merge하는 조건이 아니다. `TC-03`과 `TC-04`가 그 gate를 켜고, 그때 이미 트리에 있는 계약도 대상에 포함한다. active requirement는 이후 `docs/requirements/active/`에 둔다. 이 ADR과 구현 계획은 기능이 끝났다는 증거가 아니다.

## 결과

- 이후 PR은 이 파일과 소스 감사만으로 입력, 출력, 호환 정책을 정할 수 있다.
- 이후 PR이 바꾸기 전까지 공개 API, CLI flag, 저장 데이터는 그대로다.
- `PR-00`은 Sampo changeset을 추가하지 않는다. 패키지 동작이 바뀌지 않는다.
