# 릴리즈 운영 규약 (v1)

## 1) 기본 원칙

- 브레이킹 변경은 v1에서 지양하고 additive 변경 우선
- 출력 계약 변경 시 `docs/schemas/*`와 테스트를 동시에 갱신
- `idk` CLI/help/문서/스키마를 함께 동기화
- changelog/version/publish 흐름은 `sampo` 기준으로 관리

## 2) Sampo 워크플로우

초기화는 이미 저장소에 반영되어 있습니다.

- 설정 파일: [config.toml](/Users/imjlk/repos/imjlk/idlekit/.sampo/config.toml)
- pending changeset: [.sampo/changesets](/Users/imjlk/repos/imjlk/idlekit/.sampo/changesets)

변경을 추가할 때:

```bash
bun run changeset:add
```

현재 브랜치에서 릴리즈 계산만 확인할 때:

```bash
bun run release:plan
```

실제 version/changelog 갱신:

```bash
bun run release:version
```

publish dry-run:

```bash
bun run release:publish:dry-run
```

노트:

- 현재 설정은 `main`만 release branch로 취급합니다.
- feature branch에서 릴리즈 계산을 보고 싶어서 `release:plan`은 `SAMPO_RELEASE_BRANCH=main`을 강제로 넣었습니다.

## 3) 릴리즈 전 체크리스트

```bash
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run templates:check
bun run release:plan
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

## 4) 배포 산출물 확인

- workspace 패키지 tarball 생성 확인(`npm pack --json`)
- `@idlekit/money`, `@idlekit/core`, `@idlekit/cli` 버전 일관성 확인
- `packages/cli`의 bin 이름이 `idk`인지 확인
- `sampo release`가 package changelog/version을 정상 갱신했는지 확인

## 5) 문제 발생 시 triage

1. 계약 실패: schema/test 우선 수정, 문서 동기화
2. 성능 실패: bench 시나리오별 p95/RSS 확인 후 step/eventLog 정책 점검
3. KPI 회귀: `at7d/at30d/at90d`에서 `stallRatio/droppedRate/endNetWorth` 원인 분석
4. 재현성 실패: artifact `replay verify`로 drift 원인(runId/seed/scenarioHash/pluginDigest) 점검
5. release 계산 실패: `.sampo/config.toml`, pending changeset frontmatter, branch 설정을 먼저 확인
