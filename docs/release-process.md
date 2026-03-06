# 릴리즈 운영 규약 (v1)

## 1) 기본 원칙

- 브레이킹 변경은 v1에서 지양하고 additive 변경 우선
- 출력 계약 변경 시 `docs/schemas/*`와 테스트를 동시에 갱신
- `idk` CLI/help/문서/스키마를 함께 동기화

## 2) 릴리즈 전 체크리스트

```bash
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run release:dry-run
```

성공 기준:

- 회귀 게이트(`kpi:regress`) 통과
- artifact/output schema 테스트 통과
- `tmp/release-dry-run.json` 생성

## 3) 배포 산출물 확인

- workspace 패키지 tarball 생성 확인(`npm pack --json`)
- `@idlekit/money`, `@idlekit/core`, `@idlekit/cli` 버전 일관성 확인
- `packages/cli`의 bin 이름이 `idk`인지 확인

## 4) 문제 발생 시 triage

1. 계약 실패: schema/test 우선 수정, 문서 동기화
2. 성능 실패: bench 시나리오별 p95/RSS 확인 후 step/eventLog 정책 점검
3. KPI 회귀: `at7d/at30d/at90d`에서 `stallRatio/droppedRate/endNetWorth` 원인 분석
4. 재현성 실패: artifact `replay verify`로 drift 원인(runId/seed/scenarioHash/pluginDigest) 점검
