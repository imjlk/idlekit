# Sampo configuration for idlekit

Korean version: [README_ko.md](./README_ko.md)

`idlekit` uses Sampo for changesets, version bumps, changelog generation, and publish automation.

## Local workflow

```bash
bun run changeset:add
bun run release:plan
bun run release:version
bun run release:publish:dry-run
```

## Changeset authoring rules

Add a changeset when a change affects:

- public package behavior, contracts, outputs, or shipped artifacts
- the user-visible CLI flow or documented commands
- release notes that operators or users should see

You can usually skip a changeset for:

- typo-only documentation edits
- internal test additions
- refactors that do not change package behavior or outputs

### Format

```md
---
npm/@idlekit/cli: patch
---

Short user-facing summary.
```

### Package keys

Use only these package keys:

- `npm/@idlekit/money`
- `npm/@idlekit/core`
- `npm/@idlekit/cli`

### Versioning policy

- `patch`: non-breaking fixes and additive UX improvements
- `minor`: additive public capabilities
- `major`: breaking changes

Current policy: do not ship `major` bumps during v1. If a breaking change becomes necessary,
prepare a migration path and deprecation plan first.

## Files

- [config.toml](./config.toml): release branch and changelog settings
- [changesets/](./changesets): pending release notes
- [../docs/release-process.md](../docs/release-process.md): public release process guide
