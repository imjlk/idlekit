# Contributing

Thank you for contributing to `idlekit`.

## Development flow

```bash
bun install
bun run typecheck
bun run runtime:check
bun run test
bun run build
bun run docs:verify:quick
bun run templates:check
bun run install:smoke
bun run public:check
```

## Pull request rules

- keep changes small and decision-complete
- update tests and docs together with behavior changes
- add a Sampo changeset for user-facing package changes
- follow the v1 policy: avoid breaking changes

## Changesets

Use:

```bash
bun run changeset:add
bun run release:plan
```

See [.sampo/README.md](./.sampo/README.md) and [docs/release-process.md](./docs/release-process.md).

## Docs policy

- English files are canonical
- Korean translations use the `_ko.md` suffix
- keep relative links valid for GitHub browsing
