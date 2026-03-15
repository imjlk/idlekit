# Release Process (v1)

Korean version: [release-process_ko.md](./release-process_ko.md)

Roadmap: [roadmap.md](./roadmap.md)
Public repo operations: [public-repo-ops.md](./public-repo-ops.md)

Official support in v1: Bun `>=1.3` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

## Principles

- Prefer additive v1 changes over breaking changes
- Update CLI help, docs, schemas, and tests together
- Manage changelogs, version bumps, and publishing through Sampo
- `bunli release` is not part of this repository's release contract
- Keep `major` bumps disabled during v1 unless a migration path is prepared
- Do not publish until design-decision gates pass: worth-aware growth, `experience`, session patterns, milestones, perceived progression, and Monte Carlo

## Sampo workflow

Key files:

- [../.sampo/config.toml](../.sampo/config.toml)
- [../.sampo/changesets](../.sampo/changesets)
- [../.github/workflows/release.yml](../.github/workflows/release.yml)

Common commands:

```bash
bun run changeset:add
bun run publish:gate
bun run readme:smoke
bun run compat:check
bun run release:plan
bun run release:version
bun run release:publish
bun run release:publish:dry-run
```

Operational setup helpers:

```bash
idk setup completions --shell zsh
idk doctor --fix true --shell zsh
idk setup plugin-trust --plugin ./custom-econ-plugin.ts --out ./.idk/plugin-trust.json
```

## GitHub automation model

`idlekit` keeps development and validation Bun-first:

- CI installs and validates with Bun
- local development commands use Bun
- release-time registry publishing uses `npm publish` only

The GitHub release workflow prepares both runtimes:

1. Bun for install/build/public checks
2. Node/npm only for registry publishing
3. Sampo as the release orchestrator

Workflow file:

- [../.github/workflows/release.yml](../.github/workflows/release.yml)

Release auth policy:

- preferred: npm Trusted Publishing with GitHub OIDC
- fallback: `NPM_TOKEN` secret exposed as `NODE_AUTH_TOKEN` at release time only
- local publish can use `NPM_CONFIG_USERCONFIG=/path/to/.npmrc`

If you use Trusted Publishing, configure npm to trust this repository and workflow before enabling automatic publish on `main`.

## Local publish preflight

For local publish runs, keep the token outside the repository and point npm at it explicitly:

```bash
cp .npmrc.publish.example .npmrc.publish.local
# edit .npmrc.publish.local or use any external .npmrc you already manage
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local bun run release:publish:preflight
```

What `release:publish:preflight` checks:

1. `publish:gate` succeeds
2. `readme:smoke` succeeds
3. `npm whoami` and `npm ping` succeed
4. current package versions are greater than already-published npm versions

If preflight passes, the matching publish command is:

```bash
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local bun run release:publish
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

## Public repo notes

- The release workflow is pinned to commit SHAs for third-party GitHub Actions.
- Keep `main` protected before enabling automatic publish on push.
- Until branch protection and registry secrets are fully configured, prefer manual dispatch.
- The release workflow upgrades npm only inside GitHub Actions so local development can stay Bun-first.
