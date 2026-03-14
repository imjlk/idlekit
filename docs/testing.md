# Testing Guide

Korean version: [testing_ko.md](./testing_ko.md)

Official support in v1: Bun `>=1.3` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

## Repository commands

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
bun run bench:sim
bun run bench:sim:suite
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
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
- init preset matrix and naming rules
- error contract coverage
- replay consistency and resume determinism
- plugin loading and security policy
- docs, templates, install smoke, public readiness, and replay gates
- perceived progression and KPI regression guardrails

## Compatibility fixtures

Compatibility fixtures live under `fixtures/compat/v1/`.

- add new fixtures for additive contract growth
- do not rewrite existing fixtures unless you are intentionally revisiting compatibility policy
- run `bun run compat:check` after adding or updating fixtures
