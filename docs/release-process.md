# Release Process (v1)

Korean version: [release-process_ko.md](./release-process_ko.md)

## Principles

- Prefer additive v1 changes over breaking changes
- Update CLI help, docs, schemas, and tests together
- Manage changelogs, version bumps, and publishing through Sampo
- Keep `major` bumps disabled during v1 unless a migration path is prepared

## Sampo workflow

Key files:

- [../.sampo/config.toml](../.sampo/config.toml)
- [../.sampo/changesets](../.sampo/changesets)
- [../.github/workflows/release.yml](../.github/workflows/release.yml)

Common commands:

```bash
bun run changeset:add
bun run release:plan
bun run release:version
bun run release:publish:dry-run
```

## Release checklist

```bash
bun run typecheck
bun run runtime:check
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run public:check
bun run replay:verify
bun run release:plan
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run release:dry-run
```

## Public repo notes

- The release workflow is pinned to commit SHAs for third-party GitHub Actions.
- Keep `main` protected before enabling automatic publish on push.
- Until branch protection and registry secrets are fully configured, prefer manual dispatch.
