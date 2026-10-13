# Balance checks

Korean version: [balance-checks_ko.md](./balance-checks_ko.md)

`PR-17` turns the a/b, 7d/30d/90d KPI regression into a metric and goal balance gate. This gate judges a game scenario. ttsc, Evidence, and Graph stay development quality gates. Neither gate replaces the other.

A check file names a metric id, an operator (`lt`, `lte`, `gt`, `gte`, `eq`, `between`), a threshold, a unit, a severity (`error` or `warn`), and a missing policy (`inconclusive`, `fail`, `unsupported`). The default path does not evaluate arbitrary JavaScript. Pass and fail are produced only when a measured point or a lower/upper bound decides the comparison. A missing or unknown value is not treated as 0. A censored lower bound can fail when the whole remaining interval misses the threshold. An unknown p95 with no bounds is inconclusive.

`idk evaluate --checks <file>` reads that file. `--fail-on` lists `error`, `warn`, `inconclusive`, and `unsupported`. The default is `error`. A blocking result exits 2. With a scenario, a blocking result also sets the workflow `ok` to false. A usage error stays on the CLI usage path. Omitting `--checks` keeps the existing evaluate workflow.

`idk kpi regress` is the compatibility adapter. Its flags and fixture shape stay. It maps the current horizon rows into the same engine. It does not rewrite a baseline. An infinite delta or ratio from a zero baseline is a censored observation bounded by the largest finite number, so the evidence stays serializable. An undefined delta (both sides zero) is unknown.

Compared identities are definition, method, scenario version, spec version, engine id, plugin version, seed, algorithm version, and unit. A mismatch is inconclusive. The report sets `baselineRewrite` to false.

Each check is judged against the observation whose identity matches every field the check pins. When none matches, the first observation with that metric id reports the mismatch. Two full matches are ambiguous and inconclusive. Bounds with lower above upper are contradictory and inconclusive. A check file must contain at least one check. An empty `checks` array, an unreadable file, and invalid JSON are usage errors. The standalone JSON document is exactly `idlekit.balance-checks.v1` and carries no `_meta` envelope.

`ScenarioV1.outputs.assertions` is declaration-only. simulate and evaluate do not execute it. The classified grammar is `path operator value` joined by `&&` and `||`. Anything else is unsupported.

Numeric results and advisory text are separate fields. Advisory text is not pass/fail evidence. The check does not call an external provider. JSON and markdown reports list failed metrics with status, value, bounds, operator, threshold, and unit.

The structural contract is `idlekit.balance-checks.v1` at [docs/schemas/balance-checks.v1.schema.json](./schemas/balance-checks.v1.schema.json). The generator also writes [docs/schemas/generated/balance-checks.v1.schema.json](./schemas/generated/balance-checks.v1.schema.json). This does not replace `ScenarioV1`.

Reproduction seed for the hour examples is `17`. A measured 1.5h first reset passes `lte` 2h. A measured 3h fails. A censored p95 lower bound of 9h fails `lte` 8h.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Commands

```bash
idk evaluate --checks checks.json
idk evaluate scenario.json --checks checks.json --fail-on error,inconclusive
idk kpi regress --baseline examples/bench/kpi-baseline.json --current examples/bench/kpi-baseline.json
```

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `2b977618db84d944be67441320ed1f1a0af4ec95446b8f2e0f22b59a260d23b5`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, and `docs:verify` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test --timeout 120000 src/sim/analysis/checks.test.ts` (from `packages/core`) | 0 |
| `bun test --timeout 120000 src/commands/balanceChecks.test.ts` (from `packages/cli`) | 0 |
| `bun run runtime:check` | 0 |
| `bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts` | 0 |
| `bun run contracts:check` | 0 |
| `bun run generate` (from `packages/cli`) | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |

The first `evidence:check` exited 2 on placeholder reviews and a fetch cast. The next exited 1 because the generated balance schema hash was stale. The rerun after `contracts:generate` exited 0. `evidence:check` and `format:check` do not include `packages/cli/src/commands/kpiRegress.ts`. The CLI test above was rerun after `runKpiRegression` was named.

## Graph

Queried with `ttsc-graph` 0.30.4 on `tsconfig.graph.json`, protocol `2025-11-25`, no generation identifier, shutdown 0. `evaluateBalanceChecks` is declared at `packages/core/src/sim/analysis/checks.ts:438`. An impact trace names `loadBalanceChecks` at `packages/cli/src/commands/evaluate.ts:104` (call at line 115), the adapter `adaptKpiRegression` at `checks.ts:590`, `runKpiRegression` at `packages/cli/src/commands/kpiRegress.ts:9` (call at line 24), and tests `verdictOf`, `judgesBoundedMetrics`, `reportsIdentityMismatch`, `adaptsKpiRegression`, `keepsAdvisoryOffTheVerdict`, and `validatesFailureReport`. The trace is not every caller. JSON check files and package scripts are outside the graph.
