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
- `docs-verify (quick)`
- `docs-verify (full)`
- `Analyze (javascript-typescript)`

`Release` workflow는 merge gate로 강제하지 않습니다.

## 릴리즈 workflow 정책

- release는 protected `main` 또는 manual dispatch에서만 허용
- 감독 가능한 수동 릴리즈를 위해 `workflow_dispatch` 유지
- npm Trusted Publishing을 위해 `id-token: write` 유지
- `NPM_TOKEN`은 fallback 용도로만 유지

## npm org `idlekit` 체크리스트

첫 public publish 전 확인 항목:

1. `idlekit` npm org가 `@idlekit/*` scope를 소유하는지 확인
2. GitHub repository/workflow를 Trusted Publishing에 연결
3. provenance 활성화 확인
4. Trusted Publishing 안정화 전까지 fallback `NPM_TOKEN` secret 유지
5. `bun run release:publish:preflight` 실행

## 이미 포함된 자동화

저장소에는 이미 아래 항목이 포함되어 있습니다.

- issue template
- pull request template
- CI
- docs verify
- release workflow
- Dependabot
- CodeQL
