# Sampo

`idlekit`은 changelog/versioning/publish 흐름을 Sampo 기준으로 관리합니다.

## Local workflow

```bash
bun run changeset:add
bun run release:plan
bun run release:version
bun run release:publish:dry-run
```

## Changeset authoring rules

다음 기능 변경부터는 PR/작업 단위마다 `.sampo/changesets/*.md`를 같이 관리합니다.

작성 규칙:

- user-facing 영향이 있는 변경이면 changeset을 추가합니다.
- 문서만 바꾸는 변경, 테스트만 보강하는 변경, 내부 리팩토링만 있고 패키지 동작/계약/출력이 안 바뀌면 changeset 없이 진행할 수 있습니다.
- changeset 1개는 `하나의 논리적 배포 단위`만 설명합니다. unrelated 변경을 한 파일에 섞지 않습니다.
- front matter 패키지 키는 canonical id를 사용합니다.
  - npm 패키지: `npm/@idlekit/money`, `npm/@idlekit/core`, `npm/@idlekit/cli`
- bump 수준은 아래 기준으로 고정합니다.
  - `patch`: 버그 수정, additive 문서/출력 개선, non-breaking CLI UX 개선
  - `minor`: 새 명령, 새 옵션, additive 공개 API, 새 시나리오/분석 기능
  - `major`: 기존 계약/출력/CLI 사용법을 깨는 변경
- 본문은 “무엇을 바꿨는지”보다 “사용자/운영자가 무엇을 얻게 되는지”를 1~3문장으로 씁니다.
- changeset 파일은 `.sampo/changesets/*.md`만 허용합니다. 설명용 README를 넣지 않습니다.
- 빈 디렉터리 유지는 `.sampo/changesets/.gitkeep`만 사용합니다.

예시:

```md
---
npm/@idlekit/cli: patch
npm/@idlekit/core: minor
---

Add replay verification hints to CLI output and expose a new additive core analysis helper
for long-horizon pacing checks.
```

검토 체크:

- 변경한 패키지가 front matter에 모두 들어갔는지
- bump 수준이 실제 계약 변경 강도와 맞는지
- 본문이 changelog에 그대로 들어가도 읽히는지
- `bun run release:plan`이 통과하는지

## Files

- `config.toml`: release branch / changelog policy
- `changesets/*.md`: pending package changes
- `changesets/.gitkeep`: 빈 changesets 디렉터리 유지용 파일
- `.github/workflows/release.yml`: `main` push / 수동 실행용 release workflow

## Notes

- canonical release branch는 `main`
- feature branch에서 dry-run을 보려면 `bun run release:plan`을 사용
- actual publishing 전에는 `bun run templates:check`, `bun run docs:verify`, `bun run replay:verify`까지 같이 확인

## Upstream links

- Documentation: https://github.com/bruits/sampo/blob/main/crates/sampo/README.md
- GitHub Action: https://github.com/bruits/sampo/blob/main/crates/sampo-github-action/README.md
