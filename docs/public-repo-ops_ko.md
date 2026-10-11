# 공개 저장소 운영 가이드

English version: [public-repo-ops.md](./public-repo-ops.md)

이 문서는 `idlekit`를 공개 GitHub 저장소로 운영할 때 고정해야 할 저장소 설정을 정리합니다.

## 브랜치 보호

`main`에는 아래 기본 정책을 권장합니다.

- PR merge 필수
- 최소 1명 리뷰 승인 필수
- 새 커밋이 올라오면 stale review dismiss
- linear history 유지
- unresolved conversation 금지
- squash merge 우선

`main` required checks:

- `quality`
- `docs-verify`
- `Analyze (javascript-typescript)`

`Release` workflow는 merge gate로 강제하지 않습니다.

## 릴리즈 workflow 정책

- `main` push와 기본 수동 실행은 릴리즈 PR을 준비하고 CI를 실행
- 릴리즈 PR을 머지하면 배포하며, `main`에서 `publish=true` 수동 실행은 실패한 배포의 재시도
- npm Trusted Publishing의 `id-token: write`는 배포 job에만 부여
- npm Trusted Publishing으로만 배포하며, workflow는 npm 토큰을 전달하지 않음

## npm org `idlekit` 체크리스트

npm은 이미 존재하는 패키지에만 workflow 신뢰를 설정할 수 있으므로, 새 `@idlekit/*` 패키지는 로컬 배포 한 번으로 시작합니다.

npm에 아직 없는 패키지:

1. `idlekit` npm org가 `@idlekit/*` scope를 소유하는지 확인
2. `bun run release:publish:preflight` 실행
3. 첫 버전을 로컬 배포하고 ([release-process_ko.md](./release-process_ko.md#로컬-publish-preflight) 참고), 그 버전을 `tools/release-registry.ts`의 `PROVENANCE_EXEMPT`에 추가
4. 패키지의 다음 버전을 배포할 준비가 되면 이 저장소와 `release.yml`을 Trusted Publisher로 등록하고, **Allowed actions**에 `npm publish`를 포함 (2026-09-03 이후 만든 설정은 기본적으로 `npm stage publish`만 허용)
5. 그 버전의 릴리즈 PR을 머지해 Release workflow가 설정 후 2일 안에 첫 배포를 성공적으로 마치게 함: npm은 그때까지 배포를 마치지 못한 새 Trusted Publisher 설정을 만료시키며, 만료된 설정은 지우고 다시 만들어야 함
6. 패키지를 2FA 필수, 토큰 배포 차단으로 설정

[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) 참고.

이후 버전은 릴리즈 PR을 머지하면 됩니다. Release workflow가 배포하고 provenance와 npm 설치를 확인합니다.

## 이미 포함된 자동화

저장소에는 이미 아래 항목이 포함되어 있습니다.

- issue template
- pull request template
- CI
- docs verify
- release workflow
- Dependabot
- CodeQL
