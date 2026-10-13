# Optional analysis judge

Korean version: [optional-analysis-judge_ko.md](./optional-analysis-judge_ko.md)

`PR-18` adds an optional rules judge on top of a finished analysis artifact. It advises. It does not replace the balance-check gate, and it does not replace ttsc, Evidence, or Graph.

`idk judge <analysis.json> --rubric <rubric.json> --provider rules` is the command. `--provider` accepts `rules` only. `idk doctor` still diagnoses the local CLI. `idk evaluate` does not call this judge unless you run `judge` yourself.

The rubric is data: schema version 1, contract `idlekit.judge.rubric.v1`, a rubric version, and rules. Each rule names a metric id, an operator, a threshold, a unit, a severity, and a missing policy. Unknown fields are rejected. The command does not evaluate rubric strings as code.

Numeric pass and fail come from the balance-check engine. A measured 1.5h first reset passes `lte` 2. A measured 3h fails inside `numerical` and is also a semantic `conflict`. The numerical object is not rewritten. `baselineRewrite` stays false. An amount decimal is not narrowed to a JavaScript number.

A rubric metric id that is not on the artifact is rejected, and so is one that matches more than one reading. An artifact algorithm version other than `analysis-artifact-v1` is rejected. An estimate is listed under `estimatedObservations` and is not a measured pass. An unavailable reading stays `insufficient`, also when its rule uses `missingPolicy: "fail"` and the numerical verdict fails. An artifact that fails the semantic contract (for example a numeric reading that also carries an amount) is rejected before judging. An unavailable reading omits its method, and an unavailable amount omits its unit; the rule supplies those, so the missing policy decides the numerical verdict. An available amount reading, observed or estimated, is unsupported. When the artifact declares an unknown metrics capability or `incomplete`, `unknown`, or `disabled` coverage, an observed value is not treated as measured and stays `insufficient`. A reading that records no method (observed readings from `readMetric` and unavailable readings) is not compared on method; a method the reading records must match. A measured reading under a different identity is `indeterminate` with `rec.metric.identity-mismatch`.

English and Korean sentences are templates selected by `recommendationId`. A rule's `recommendationId` selects the template for its own measured conflict. Pass, estimate, insufficient, and unsupported outcomes use their fixed templates. The advisory digest is `rules:<rubricVersion>:<recommendation ids>`. The same inputs produce the same digest. The path does not fetch.

The structural contract is `idlekit.judge.v1` at [docs/schemas/judge.output.schema.json](./schemas/judge.output.schema.json). The generator also writes [docs/schemas/generated/judge.v1.schema.json](./schemas/generated/judge.v1.schema.json). This does not replace `ScenarioV1` or the balance-check document. JSON output is exactly that document and carries no `_meta` envelope. `--out` writes JSON, Markdown, and CSV alike. CSV has one row per rule with the numerical verdict, evidence, and diagnostic.

Reproduction label for the hour examples is `18`.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Commands

```bash
idk judge analysis.json --rubric rubric.json --provider rules
idk doctor --format json
```

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `c76f5b63b365d451781089094275b6c2fc0fc186d1ccaa3036761f2c1277f852`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, `docs:verify`, `readme:smoke`, `install:smoke`, and `review:smoke` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test --timeout 120000 src/sim/analysis/judge.test.ts` (from `packages/core`) | 0 |
| `bun test --timeout 120000 src/commands/judge.test.ts` (from `packages/cli`) | 0 |
| `bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts` | 0 |
| `bun run contracts:check` | 0 |
| `bun run generate` (from `packages/cli`) | 0 |
| `bun run generate:check` (from `packages/cli`) | 0 |
| `bun run doctor:completions` (from `packages/cli`) | 0 |
| `bun run runtime:check` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |

The first `evidence:check` exited 2 on placeholder reviews. The rerun after those reviews exited 0. `graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0.

## Graph

Queried at commit `98798b8` with `ttsc-graph` 0.30.4 on `tsconfig.graph.json` (the aggregate project), protocol `2025-11-25`, no generation identifier, shutdown 0. `judgeArtifact` is declared at `packages/core/src/sim/analysis/judge.ts:394`. An impact trace names `evaluateRules` at `packages/cli/src/lib/evaluation/rules.ts:4` (call at line 5), `runJudge` at `packages/cli/src/commands/judge.ts:59` (call at line 83), and tests `acceptsRulesProvider`, `reusesBalanceChecks`, `rejectsBadRefs`, `separatesReportLayers`, and `withholdsHealthLabels`. The trace is not every caller. JSON rubrics and artifacts are outside the graph.
