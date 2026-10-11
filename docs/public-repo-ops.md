# Public Repo Operations

Korean version: [public-repo-ops_ko.md](./public-repo-ops_ko.md)

This document describes the repository settings that should be enabled once `idlekit` is operating as a public GitHub repository.

## Branch protection

Protect `main` with these defaults:

- require pull requests before merging
- require approval from at least 1 reviewer
- dismiss stale reviews when new commits are pushed
- require linear history
- require conversation resolution before merge
- prefer squash merge

Required checks on `main`:

- `quality`
- `docs-verify`
- `Analyze (javascript-typescript)`

Do not require the `Release` workflow as a merge gate.

## Release workflow policy

- prepare release PRs on `main` pushes and default manual dispatches
- publish only from an explicit manual `publish=true` dispatch on `main`, after the release PR is merged
- scope `id-token: write` for npm Trusted Publishing to the publish job
- publish through npm Trusted Publishing only; the workflow passes no npm token

## npm org `idlekit` checklist

npm can trust a workflow only for a package that already exists, so a new `@idlekit/*` package starts with one local publish.

For a package that is not on npm yet:

1. confirm the `idlekit` npm org owns the `@idlekit/*` scope
2. run `bun run release:publish:preflight`
3. publish its first version locally with your own npm login (`bun run release:publish`, see [release-process.md](./release-process.md#local-publish-preflight))
4. on npm, add this repository and `release.yml` as the package's Trusted Publisher
5. set the package to require 2FA and disallow tokens

For every later version, merge the release PR and run the Release workflow with `publish=true`. Check that the published version has provenance.

## Automation already included

The repository already includes:

- issue templates
- a pull request template
- CI
- docs verification
- release workflow
- Dependabot
- CodeQL
