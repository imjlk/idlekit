# Contributing

Thank you for contributing to `idlekit`.

## Development flow

```bash
bun install
bun run typecheck
bun run graph:check
bun run runtime:check
bun run test
bun run build
bun run docs:verify:quick
bun run templates:check
bun run install:smoke
bun run public:check
```

## Evidence

Active requirements live in `docs/requirements/active/` as H2 headings with an explicit `{#anchor}`. `bun run evidence:check` fails when a heading has no production citation and no executed test citation. Production and test claims are separate. A test citation does not satisfy the implementation claim.

Do not `@evidenceExclude` a core requirement to turn the check green. Planned work stays in `docs/requirements/planned/` until its PR adds a host and a test. Shrinking `docs/requirements/coverage-baseline.json` needs an approval file under `docs/requirements/approvals/`.

A test that carries `@evidence` must be an exported function and must be registered with `it(name, fn)` or `test(name, fn)`. Inventory reads the bun test reporter. Evidence does not decide whether the assertion is true.

`@ttsc/evidence` is registered in `lint.config.ts` as a `@ttsc/lint` contributor. Do not add it to `compilerOptions.plugins`. `@evidenceReview` fingerprints come from the `ttsc` diagnostic after re-reading the cited target. Do not invent them.

## Graph

`bun run graph:check` queries the local `ttsc-graph` server for `tsconfig.graph.json`. Start from `tour` or `lookup`, then `details` or `trace`, then read the cited span. Graph rank does not drop the test suite. JSON, YAML, shell, dynamic plugin loads, and `package.json` exports are outside the graph. Do not record opaque node ids. `@ttsc/graph` is a root devDependency and is not imported by published packages.

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
