# 릴리즈 운영 규약 (v1)

## 1) 기본 원칙

- 브레이킹 변경은 v1에서 지양하고 additive 변경 우선
- 출력 계약 변경 시 `docs/schemas/*`와 테스트를 동시에 갱신
- `idk` CLI/help/문서/스키마를 함께 동기화
- changelog/version/publish 흐름은 `sampo` 기준으로 관리

## 2) Sampo 워크플로우

초기화는 이미 저장소에 반영되어 있습니다.

- 설정 파일: [config.toml](../.sampo/config.toml)
- pending changeset: [.sampo/changesets](../.sampo/changesets)
- GitHub workflow: [release.yml](../.github/workflows/release.yml)

변경을 추가할 때:

```bash
bun run changeset:add
```

### Changeset 작성 규칙

다음 조건이면 changeset이 필요합니다.

- `@idlekit/money`, `@idlekit/core`, `@idlekit/cli`의 동작/계약/출력/배포 산출물에 영향이 있는 변경
- 사용자 문서에서 안내하는 명령/흐름이 달라지는 변경
- changelog에 남겨야 하는 기능 추가, 수정, 운영 정책 변경

다음 조건이면 보통 changeset 없이 진행합니다.

- 문서 오탈자만 수정
- 내부 테스트만 추가
- 배포 패키지 동작이 바뀌지 않는 리팩토링

작성 형식:

```md
---
npm/@idlekit/cli: patch
---

Short user-facing summary.
```

팀 규칙:

- 패키지 키는 `npm/@idlekit/money`, `npm/@idlekit/core`, `npm/@idlekit/cli`만 사용
- bump 기준은 `patch=non-breaking fix/additive UX`, `minor=new additive capability`, `major=breaking change`
- 현재 운영 방침은 `당분간 major bump 금지`입니다. breaking 변경이 필요하면 바로 `major`로 올리지 말고 deprecation, additive 대안, 마이그레이션 문서를 먼저 준비한 뒤 별도 검토를 거칩니다.
- unrelated 변경은 한 changeset에 섞지 않음
- 본문은 changelog에 그대로 들어가므로 “사용자 영향” 위주로 작성
- `.sampo/changesets`에는 frontmatter가 있는 `*.md`만 두고, 보조 문서는 두지 않음

검토 루틴:

```bash
bun run release:plan
```

성공 조건:

- front matter parse 성공
- 변경 패키지/버전 bump가 기대와 일치
- changeset 본문이 changelog 문장으로 그대로 읽힘

현재 브랜치에서 릴리즈 계산만 확인할 때:

```bash
bun run release:plan
```

`release:plan`은 changeset이 없는 경우도 informational 상태로 처리합니다. `.sampo/changesets`는 `.gitkeep`만 두고, 실제 changeset은 frontmatter가 있는 `*.md` 파일만 추가합니다.

실제 version/changelog 갱신:

```bash
bun run release:version
```

실제 publish:

```bash
bun run release:publish
```

publish dry-run:

```bash
bun run release:publish:dry-run
```

### GitHub 자동화 모델

`idlekit`은 개발/검증은 Bun-first로 유지하고, 릴리즈 시점 배포에만 npm을 사용합니다.

- CI와 로컬 개발: Bun
- registry publish: `npm publish`
- release orchestration: Sampo

관련 workflow:

- [release.yml](../.github/workflows/release.yml)

GitHub Actions release job은 아래 순서로 동작합니다.

1. Bun으로 install / build / public check / release plan
2. Node/npm을 publish 전용으로 준비
3. Sampo가 version/changelog/tag/publish를 실행

인증 정책:

- 기본: npm Trusted Publishing + GitHub OIDC
- fallback: `NPM_TOKEN`을 `NODE_AUTH_TOKEN`으로 주입
- 로컬 publish는 `NPM_CONFIG_USERCONFIG=/path/to/.npmrc` 방식 지원

즉, 평소 개발에서 npm을 쓰는 게 아니라, GitHub release 경로에서만 npm publish를 호출합니다.

### 로컬 publish preflight

로컬 publish는 토큰 파일을 저장소 밖에 두고, 필요할 때만 npm 설정 파일 경로를 넘기는 방식으로 가는 게 안전합니다.

```bash
cp .npmrc.publish.example .npmrc.publish.local
# .npmrc.publish.local 또는 기존 외부 .npmrc를 사용
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local bun run release:publish:preflight
```

`release:publish:preflight`가 확인하는 항목:

1. build 성공
2. tarball/install smoke 성공
3. public package/readme check 통과
4. `npm whoami`, `npm ping` 성공
5. 현재 패키지 버전이 npm에 이미 올라간 버전보다 높은지

preflight가 통과하면 실제 publish 명령은 아래입니다.

```bash
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local bun run release:publish
```

노트:

- 현재 설정은 `main`만 release branch로 취급합니다.
- feature branch에서 릴리즈 계산을 보고 싶어서 `release:plan`은 `SAMPO_RELEASE_BRANCH=main`을 강제로 넣었습니다.
- GitHub Actions에서는 `main` push 또는 수동 실행 시 `sampo auto`로 release/publish 흐름을 처리합니다.
- GitHub release workflow 안에서는 npm만 publish 용도로 준비하고, 나머지 install/build/check는 계속 Bun으로 실행합니다.

## 3) 릴리즈 전 체크리스트

```bash
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run templates:check
bun run install:smoke
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
