# 로드맵

English version: [roadmap.md](./roadmap.md)

이 문서는 `idlekit`이 현재 어디까지 구현되어 있고, 공개 npm 배포 전에 무엇이 충족되어야 하며, 첫 공개 이후 어떤 방향으로 확장할지를 정리합니다.

## 현재 상태

현재 저장소는 이미 아래를 지원합니다.

- deterministic 경제 시뮬레이션
- 전략 튜닝과 replay artifact
- 오프라인 catch-up과 상태 저장/복원
- 세션 패턴, milestone, perceived progression, growth를 포함한 `experience` 분석
- 장기 구간 `ltv` / `kpi` 평가
- 플러그인 기반 canonical worked example인 `Orbital Foundry`

이 export들이 곧 완성된 분석 계약은 아니다. ETA, prestige-cycle, growth, session 시뮬레이션, Monte Carlo, strategy tuner, 프로세스 안 `evaluate`, `review`, KPI 회귀, replay는 이미 있다. 공유 의미와 버전 정책은 [분석 계약](./adr/analysis-contracts_ko.md)에 있다. 소스 인벤토리는 [소스 감사](./implementation/source-audit_ko.md)에 있다.

## 분석 트랙

정확성 작업은 툴체인 다음, conformance harness 다음에 온다.

1. ADR과 소스 감사의 기준 계약.
2. `TC-01`–`TC-04`: ttsc check/emit, Bun 변환, Evidence, Graph.
3. `DX-01`: seeded conformance 테스트.
4. `PR-01`–`PR-07`: 결제, 시간 경계, 실행 격리, 관측, 세션 시간, resolved run configuration.
5. 새 분석 DTO 전의 `TC-05`, 이어서 `PR-08`–`PR-14`.
6. `DX-02`–`DX-04`: analyzer registry, inspect, 런타임 성능 예산.
7. `PR-17`과 `PR-18`: 결정적 밸런스 check, 그다음 선택적 rule judge.
8. `PR-20`: 선택한 범위의 통합 fixture, 문서, 패키징, consumer gate.

`PR-15`(흐름 관측), `PR-16`(가드된 시간 건너뛰기), `PR-19`(Jev provider), `DX-05`(worker backend)는 선택이다.

`265c6ed`에서 root `packageManager`는 `bun@1.3.10`이고 CI는 Bun `1.3.9`를 pin한다. check와 emit은 아직 `tsc`다. `TC-01`이 host를 맞추고 check/emit을 ttsc로 옮긴다. 그 compiler가 필요로 하는 개발용 Node나 Go는 host 세부사항이다. 제품 런타임은 Bun-first를 유지한다.

`prestigeCycle.stability`는 정상상태 측정값이 아니다. `createBreakEternityEngine`은 미구현 placeholder다.

## 공개 배포 전 게이트

아래 게이트가 함께 녹색일 때만 public publish 후보로 봅니다.

- `bun run typecheck`
- `bun run test`
- `bun run docs:verify`
- `bun run templates:check`
- `bun run public:check`
- `bun run kpi:report`
- `bun run kpi:regress`
- `bun run release:publish:preflight`

제품 관점의 공개 기준은 아래와 같습니다.

- personal scaffold 흐름이 플러그인 없이 동작해야 함
- Orbital Foundry 예제가 실제 design tradeoff 분석을 보여줘야 함
- 문서가 첫 사용 흐름과 본격적인 설계 평가 흐름을 모두 설명해야 함
- package landing page 설명이 실제 지원 범위와 계속 맞아야 함

## v1 로드맵

### 1. Publish readiness

- 영문 canonical 문서와 한국어 `_ko` 문서를 계속 동기화
- Orbital Foundry를 대표 worked example로 유지
- release, pack, replay, docs 게이트를 계속 녹색으로 유지

### 2. Design report polish

- `experience --format md`를 더 읽기 좋게 개선
- `compare` 요약을 design tradeoff 중심으로 보강
- report와 KPI 출력에 더 직접적인 decision hint를 추가

### 3. Real design library

- 서로 다른 design intent를 가진 canonical game concept를 추가
- milestone convention과 tuning objective 예시를 더 확장
- session pattern / perceived progression 가이드를 더 보강

### 4. Post-v1 extensions

- explicit seeded randomness 기반의 stochastic gameplay model
- richer automation / prestige 예제
- 외부 소비자를 위한 adapter/plugin 예시 확대

## v1에서 기대하지 않는 것

- 잦은 breaking public API 변경
- major version bump
- 임의의 calendar DSL 수준 세션 정의
- explicit seeded Monte Carlo 경로 밖의 non-deterministic core 동작
- 제품 런타임으로서의 Node.js 또는 브라우저 지원
- 완성된 `breakEternity` 엔진
- 공개 배포의 필수 gate로서의 Jev
