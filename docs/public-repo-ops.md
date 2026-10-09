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
- expose fallback `NPM_TOKEN` only to the publish step

## npm org `idlekit` checklist

Before the first public publish:

1. confirm the `idlekit` npm org owns the `@idlekit/*` scope
2. connect the GitHub repository/workflow for Trusted Publishing
3. verify provenance is enabled
4. keep a fallback `NPM_TOKEN` secret available until Trusted Publishing is proven stable
5. run `bun run release:publish:preflight`

## Automation already included

The repository already includes:

- issue templates
- a pull request template
- CI
- docs verification
- release workflow
- Dependabot
- CodeQL
