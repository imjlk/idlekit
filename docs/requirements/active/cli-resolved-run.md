# Resolved run configuration

## One plan opens a fresh stage {#req-pr07-resolved-run}

Requirement `REQ-PR07-RESOLVED-RUN`. `PR-07` owns it.

`resolvedRunContract` in `packages/cli/src/lib/runConfiguration.ts` is `idlekit.resolved-run-configuration`. `sessionCaseSeed` is `0x7107`. `TC-05` has not registered that DTO. The executed tests use seed `1`. They do not draw from `0x7107`.

`prepareResolvedRun` reads one validated scenario, resolves the engine and the strategy, compiles once, and rejects an unknown strategy. `open` builds a stage plan and a fresh `createRunFactory` instance. Simulate, experience, and ltv do not share one compiled strategy or model. The plan stores ids, params, step, session, seed, and plugin digest values. It does not store an engine instance, a file handle, a secret, a timestamp, or an absolute path.

`scenario.engine` is metadata. It is recorded and not applied. An omitted `--engine` uses `number`. `--engine number` selects the same engine. `--engine breakInfinity` constructs `createBreakInfinityEngine`. `from("1e400")` stays on that engine. It is not passed through `Number` first. `--engine breakEternity` throws `BREAK_ETERNITY_EXPERIMENTAL_MESSAGE`. A custom id runs only when the caller already holds a trusted factory with that id. An unknown id does not load a plugin.

`--strategy` accepts a registered strategy id on `evaluate`, `simulate`, `experience`, `ltv`, and `review evaluate`. Builtins stay `greedy`, `planner`, and `scripted`. An unknown id is rejected. Plugins are not auto-approved. `compare` and `review compare` stay on the builtin enum.

Strategy applies to simulate, experience, and ltv. `--step` and `--fast` apply to simulate and ltv. They apply to experience only when `--consistent-overrides` is true. Session pattern and days stay on experience. Each stage records that scope. `ctx.stepSec` and `run.stepSec` are the stage step. A planner preview reads `ctx.stepSec`.

Strategy params default to `legacy-raw`. The internal `StandardSchema` adapter checks the schema and still passes the caller object. `validated` passes `result.value`. That adapter is not the external Standard Schema package. `compileScenario` keeps `legacy-raw`.

Amount `until` paths are `money`, `wallet.money`, `wallet.money.amount`, `bucket`, `wallet.bucket`, `maxMoneyEver`, `maxMoneyEver.amount`, `prestige.points`, and `prestige.multiplier`. Those paths call `parseMoney` when suffix notation is allowed and the right-hand side has a suffix. A numeric left value does not switch them to `Number(rawRight)`. `t` and `prestige.count` stay finite number comparisons. A non-finite amount fails closed.

`scenarioHash` remains a hash of the original scenario object. `effectiveRunHash` is a stage digest. It adds the contract, version, scenario, engine id, strategy id, params, params mode, the step and fast the stage applied, the session when the stage applies it, seed, plugin digest values in load order, the stage name and scope, and the command inputs that change that stage result: simulate duration, offline seconds, the resume state the run reads (state, engine name, strategy id, version, and state, not `meta`), and event log flags; experience draws; ltv horizons, draws, and value per worth. It ignores `generatedAt`, the working directory, and absolute paths. The default seed hashes the same resume state. The same digest values in the same order from different directories match. Plugin order changes the hash, because a later plugin replaces an earlier one that registers the same model or strategy id. Changing strategy, step, or one of those inputs changes the hash. Each evaluate stage file carries its own stage digest. Every evaluate stage runs on one seed. Without `--seed`, that seed reads the scenario, strategy, and engine, which every stage applies. Step, fast, session, draws, and horizons change only the digest of a stage that applies them, so `--step` leaves the experience seed and digest unchanged. An explicit `--seed` goes to every stage. The evaluate summary hashes the three stage digests, so `--consistent-overrides` changes it. Evaluate metadata includes the scenario, the hash, the effective engine, and the stage scope.

The executed tests are `keepsResolvedRunConfiguration` and `digestsEachStageFromItsAppliedPlan` in `packages/cli/src/lib/runConfiguration.test.ts`. The second one checks the stage and workflow digests.
