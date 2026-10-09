# 릴리즈 운영 규약 (v1)

영문 기준 로드맵: [roadmap.md](./roadmap.md)
공개 저장소 운영 가이드: [public-repo-ops.md](./public-repo-ops.md)

v1 공식 지원 범위는 Bun `>=1.4.2`입니다. Node.js와 브라우저 런타임은 v1 호환성 계약에 포함하지 않습니다.

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
bun run publish:gate
bun run readme:smoke
bun run compat:check
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

Bun 지원 하한 변경에는 [Bun 1.4.2 및 Gunshi 마이그레이션 안내](./bun-14-migration_ko.md)를 준비했습니다. 관리자는 이번 마이그레이션의 `minor` bump를 승인했습니다. 이 변경의 changeset, 마이그레이션 안내와 릴리즈 계획은 릴리즈 PR 승인 전에 검토해야 합니다.

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

`main` push와 `publish=false` 수동 실행은 보류 중인 changeset에서 버전, changelog,
Bun workspace lockfile을 생성하고 Ready 상태의 `release/main` PR을 만들거나 갱신합니다.
브랜치 보호 설정과 관계없이 동작하며, changeset이 없으면 아무 작업도 하지 않습니다.
PR을 자동 머지하거나 패키지를 배포하지 않습니다.

고정한 Sampo action의 `release` 명령은 버전과 changelog만 변경하므로 PR 생성은
워크플로가 따로 수행합니다. `auto`는 배포로 이어질 수 있어 사용하지 않습니다.
준비 job에는 npm 인증 정보와 OIDC 권한을 주지 않습니다.

배포는 릴리즈 PR을 머지하고 changeset을 소비한 뒤, `main`에서 Release를
`publish=true`로 수동 실행해야 합니다. 이 job만 Node/npm과 대응하는 Sampo CLI를
설치하고 `publish:gate`와 `readme:smoke`를 거쳐 명시적인 `publish` 단계에 인증 정보를 제공합니다.
수동 실행에서 선택한 커밋을 checkout하고, preflight 전과 실제 배포 직전에 원격
`main`과 같은지 확인합니다. `main`이 바뀌면 새로운 수동 실행 요청이 필요합니다.

저장소 Settings → Actions → General에서 GitHub Actions의 PR 생성을 허용해야 합니다.
`GITHUB_TOKEN`으로 만든 PR의 CI 실행은 관리자의 승인이 필요할 수 있습니다.
[GitHub 공식 안내](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)를 참고하세요.

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

1. `publish:gate` 통과
2. `readme:smoke` 통과
3. `npm whoami`, `npm ping` 성공
4. 현재 패키지 버전이 npm에 이미 올라간 버전보다 높은지

preflight가 통과하면 실제 publish 명령은 아래입니다.

```bash
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local bun run release:publish
```

노트:

- 현재 설정은 `main`만 release branch로 취급합니다.
- feature branch에서 릴리즈 계산을 보고 싶어서 `release:plan`은 `SAMPO_RELEASE_BRANCH=main`을 강제로 넣었습니다.
- GitHub Actions의 `main` push와 기본 수동 실행은 릴리즈 PR만 준비합니다. 배포에는 `main`에서 명시적인 `publish=true` 수동 실행이 필요합니다.
- npm 인증은 배포 job의 `publish` 단계에만 전달하며, 나머지 install/build/check는 Bun으로 실행합니다.

## 3) 릴리즈 전 체크리스트

```bash
bun run typecheck
bun run runtime:check
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run readme:smoke
bun run compat:check
bun run public:check
bun run replay:verify
bun run publish:gate
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
