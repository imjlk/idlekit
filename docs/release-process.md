# Release Process (v1)

Korean version: [release-process_ko.md](./release-process_ko.md)

Roadmap: [roadmap.md](./roadmap.md)
Public repo operations: [public-repo-ops.md](./public-repo-ops.md)

Official support in v1: Bun `>=1.4.2` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

## Principles

- Prefer additive v1 changes over breaking changes
- Update CLI help, docs, schemas, and tests together
- Manage changelogs, version bumps, and publishing through Sampo
- `bunli release` is not part of this repository's release contract
- Keep `major` bumps disabled during v1 unless a migration path is prepared
- Do not publish until design-decision gates pass: worth-aware growth, `experience`, session patterns, milestones, perceived progression, and Monte Carlo

The Bun minimum change has a prepared [Bun 1.4.2 and Gunshi migration guide](./bun-14-migration.md). The maintainer approved a `minor` bump for this migration. Review its changeset, migration guide, and release plan before the release PR is approved.

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

Pushes to `main` and manual runs with `publish=false` prepare or update a Ready
`release/main` PR from pending changesets, including versions, changelogs, and the
Bun workspace lockfile. This works without branch protection. With no pending
changesets, preparation is a no-op. It never merges the PR. After pushing the PR
branch it dispatches CI, Docs Verify, and CodeQL on `release/main`, because pushes
made with `GITHUB_TOKEN` do not start `pull_request` workflows.

The pinned Sampo action's `release` command only edits versions and changelogs;
the workflow creates the PR separately. Its `auto` command can fall through to
publishing, so neither job uses it. The preparation job has no npm credentials
or OIDC permission.

Merging the release PR publishes. On every push to `main`, the `plan` job
(`bun tools/release-registry.ts plan`) publishes only when the pushed commit is still the
head of `main` and some package version is not on npm yet. Only a merged release PR changes
package versions, so pending changesets for later work do not hold those versions back: if
another PR lands before the release run publishes, the newer run publishes them. Any other
push skips publication with the reason in the log. An unpublished version older than the
package's npm `latest` fails the run, because npm would move `latest` backward. A manual
run with `publish=true` replans the current head of `main`, not the commit of a failed run,
and fails instead of skipping.
When npm already has every version, for example after a run whose uploads succeeded
but whose tags or GitHub releases failed, the retry only verifies the registry; create
any missing tag or GitHub release by hand.

Only the `publish` job sets up Node/npm, installs the matching Sampo CLI, runs
`publish:gate` and `readme:smoke`, and gets the OIDC permission for the `publish` step.
Its commit must still match remote `main` before preflight and immediately before
publishing. After publishing, `bun tools/release-registry.ts verify` waits for the
new versions on the registry, rejects `workspace:` specs in their registry metadata,
requires provenance for every current version except the locally bootstrapped ones in
`PROVENANCE_EXEMPT`, installs every current version from npm, and checks `idk --version`.

Sampo selects `bun publish` when `bun.lock` is present. After the final commit check,
the publish job temporarily moves that lockfile outside the checkout so Sampo selects
`npm publish` for Trusted Publishing. An `always()` step restores the original bytes
after either success or failure. Local `release:publish` commands use the same lockfile
preservation helper; preparation and build/install checks still use the committed lockfile.
After successful publication, Sampo creates version tags and GitHub releases.

Repository Settings → Actions → General must allow GitHub Actions to create pull
requests. A `GITHUB_TOKEN`-created PR can require a maintainer to approve its CI
runs; see [GitHub's workflow trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

Workflow file:

- [../.github/workflows/release.yml](../.github/workflows/release.yml)

Release auth policy:

- npm Trusted Publishing with GitHub OIDC; the workflow passes no npm token
- each published `@idlekit/*` package requires 2FA and refuses token publishes; the Release workflow is the publish path for every version after the first
- local preflight and dry runs can use `NPM_CONFIG_USERCONFIG=/path/to/.npmrc`

A package that is not on npm yet cannot trust a workflow. Publish its first version locally, then configure Trusted Publishing for this repository and `release.yml` before merging the next release PR.

## Local publish preflight

Use a local publish only for the first version of a package that is not on npm yet. A published package refuses token publishes, so later versions go through the Release workflow.

Keep the token outside the repository and point npm at it explicitly:

```bash
cp .npmrc.publish.example .npmrc.publish.local
# edit .npmrc.publish.local or use any external .npmrc you already manage
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local bun run release:publish:preflight
```

What `release:publish:preflight` checks:

1. `publish:gate` succeeds
2. `readme:smoke` succeeds
3. `npm whoami` and `npm ping` succeed
4. at least one package version is new, and no package version is lower than the one on npm (a version that is already published is skipped)

The preflight, the publish, and the manifest rewrite only know the packages listed in `tools/npm-publish-preflight.ts`, `tools/release-lockfile.ts`, `tools/package-manifest.ts`, and the prepare job of `.github/workflows/release.yml`. Add a new package to those lists first.

If preflight passes, publish with the same npm config. npm asks for a one-time password when your account requires 2FA for writes. The example config sets `provenance=true`, which npm supports only in CI, so turn provenance off for this local publish:

```bash
NPM_CONFIG_USERCONFIG=$PWD/.npmrc.publish.local NPM_CONFIG_PROVENANCE=false bun run release:publish
```

Then add the Trusted Publisher and set the package to require 2FA and disallow tokens.

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
- Protect `main` and review the release PR and its CI before merging it; merging publishes.
- Other pushes and default manual runs only prepare a PR; `publish=true` retries a publication that failed.
- The release workflow upgrades npm only inside GitHub Actions so local development can stay Bun-first.
