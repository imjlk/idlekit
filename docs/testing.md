# Testing Guide

Korean version: [testing_ko.md](./testing_ko.md)

Official support in v1: Bun `>=1.3` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

## Repository commands

```bash
bun run typecheck
bun run runtime:check
bun run --cwd packages/cli generate:check
bun run --cwd packages/cli doctor:completions
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run readme:smoke
bun run review:smoke
bun run compat:check
bun run public:check
bun run replay:verify
bun run bench:sim
bun run bench:sim:suite
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
bun tools/analysis-baseline-check.ts
```

## Test runtime rules

- Use `bun:test` as the default test runner
- Prefer `packages/cli/src/testkit/bun.ts` for CLI test I/O
- Prefer Bun APIs over `node:` imports in `packages/*/src` runtime code and `tools/`
- Enforce the runtime rule with `bun run runtime:check`
- Treat Node.js/browser execution as outside the v1 support contract unless explicitly documented otherwise

## Current coverage

Core:

- step transitions and simulation loop behavior
- strategy determinism and resume state
- scenario validation / compilation
- offline catch-up and serializer validation

CLI:

- output schemas and replay artifact contracts
- `experience` schema, session-pattern replay, and design-metric comparisons
- `setup`, `doctor --fix`, `tune --wizard`, and review TUI/image flows
- init preset matrix and naming rules
- error contract coverage
- replay consistency and resume determinism
- plugin loading and security policy
- docs, templates, install smoke, public readiness, and replay gates
- interactive review smoke for `review doctor`, `review evaluate`, and `review compare`
- perceived progression and KPI regression guardrails

## Interactive review smoke

`bun run review:smoke` is a maintainer-only check for the human review path.

- it mounts the lazy-loaded `review doctor`, `review evaluate`, and `review compare` flows with a test renderer
- it verifies the shared loading shell appears first
- it verifies each dashboard reaches stable content without crashing after lazy follow-up work

## Compatibility fixtures

Compatibility fixtures live under `fixtures/compat/v1/`.

- add new fixtures for additive contract growth
- do not rewrite existing fixtures unless you are intentionally revisiting compatibility policy
- run `bun run compat:check` after adding or updating fixtures

## Analysis baseline

At `265c6ed` the repository compiler was `tsc`, tests ran with `bun test`, and the CLI bundle was Bunli. Root Bun was `1.3.10` and CI pinned Bun `1.3.9`. `TC-01` moves CI to Bun `1.3.10` and pins ttsc. `TC-02` runs package check and money/core emit through `ttsc`, with the same transform on Bun source, `bun test`, the CLI bundle, and the packed artifact. The live pins are in [Toolchain pins](./toolchain.md).

`bun tools/analysis-baseline-check.ts` checks the paths cited by the [source audit](./implementation/source-audit.md) and the current host pins.

`evidence:check`, `evidence:smoke`, and `format:check` are repository commands after `TC-03`. `graph:check` is the `TC-04` command. `contracts:generate`, `contracts:check`, and `test:conformance` are not. `toolchain:doctor` and `toolchain:prepare` are the `TC-01` host commands.

Shared meanings for later analysis work are in [Analysis contracts](./adr/analysis-contracts.md).
