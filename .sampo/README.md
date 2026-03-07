# Sampo

`idlekit`은 changelog/versioning/publish 흐름을 Sampo 기준으로 관리합니다.

## Local workflow

```bash
bun run changeset:add
bun run release:plan
bun run release:version
bun run release:publish:dry-run
```

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
