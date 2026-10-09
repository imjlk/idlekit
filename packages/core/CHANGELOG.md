# @idlekit/core

## 0.2.0 — 2026-10-09

### Minor changes

- [7bbaf97](https://github.com/imjlk/idlekit/commit/7bbaf977429d30a4e93589b6baa5320272b0327d) Route package check and money/core emit through ttsc, and stop treating an unresolved typia generic as a user-input error.
  
  - `typiaStandardSchema()` now throws `TypiaTransformMissingError`. That breaks callers who caught a failed Standard Schema result, so core is a minor bump while the package is still `0.x`: `^0.1.0` does not take `0.2.0`. A v1 major stays off until the release-process migration gates are ready. Callers that still want a failed result use `standardSchemaFromValidate()`.
  - add `standardSchemaFromValidate()`, `ConcreteQuota`, `validateConcreteQuota`, and `concreteQuotaSchema`
  - CLI flags and the `#!/usr/bin/env bun` shebang are unchanged — Thanks @imjlk!
- [9f28ee9](https://github.com/imjlk/idlekit/commit/9f28ee9537eb5d7b8bae0ae0c5e39cad16a16dda) Require Bun >=1.4.2 for all packages. Upgrade the Bun runtime and CI pins before installing this release, or retain an already installed previous package version and lockfile until the runtime can be upgraded. Follow the migration guide at https://github.com/imjlk/idlekit/blob/main/docs/bun-14-migration.md. — Thanks @imjlk!
- [ba8ad1f](https://github.com/imjlk/idlekit/commit/ba8ad1ff2d644ac9f7b2d99abee13ddd47a5f465) Add a design-decision analysis layer on top of the deterministic economy simulator.
  
  - add worth-aware growth analysis, milestone analysis, session-pattern simulation, and core Monte Carlo helpers in `@idlekit/core`
  - add the `idk experience` command for pacing, milestone, and perceived progression evaluation
  - extend compare/report/KPI flows with design-facing metrics such as milestone timing, visible progression rate, and no-reward gaps
  - document `design` and `analysis.experience` scenario fields and update tutorial/template flows around session patterns and experience checks — Thanks @imjlk!
- [3f7e9b1](https://github.com/imjlk/idlekit/commit/3f7e9b1bae6f6c53a3c1e8f800d14c9c41aad20f) Allow money ticks to return compact counts and applied/flushed amounts without retaining events. Fast simulations and planner previews use these facts to preserve observation counters and reward gaps while avoiding discarded event objects. Reuse each policy's computed precision gap for its threshold check. — Thanks @imjlk!

### Patch changes

- [cb9b1ef](https://github.com/imjlk/idlekit/commit/cb9b1ef41a4d645e1a01c7e9c8a391ff5d3db39e) Keep report experience sections and tuning design objectives independent of earlier economy runs. Rebuild candidate models and strategies per seed, analysis run, and Monte Carlo draw while preserving the candidate parameters and run overrides. Validate candidate parameters before running and refuse a declared stateful model without a factory source. — Thanks @imjlk!
- [10a4370](https://github.com/imjlk/idlekit/commit/10a4370a2ab9b1c624ca666158e3d7147346188d) Keep the planner's first wait, and keep rollout off the live state.
  
  - a leading wait stays a wait, so `decide()` returns no action for that step
  - rollout uses `stepOnce` on a cloned state and does not call the live emitter
  - `minPrestigeIntervalSec` shares one cooldown decision with the committed step
  - a missing last reset is unanchored and is not rewritten as a past time
  - the checkpoint records a committed reset time and omits it for a legacy resume
  - beam, horizon, branching, and rollout budget are capped
  - the search report is not a global optimum
  - `idlekit.prestige-cooldown` and `idlekit.planner-search` are not registered with a contract generator; that waits until TC-05 — Thanks @imjlk!
- [5ce2b54](https://github.com/imjlk/idlekit/commit/5ce2b54aa9b9495382c495d7ac74e3e5dbaefb6f) Value report timeline net worth from each selected snapshot's holdings, falling back to its current wallet rather than historical peak money. — Thanks @imjlk!
- [b741eb1](https://github.com/imjlk/idlekit/commit/b741eb12909ed15fae5026c82e06f71676a8a4ac) Document how consumers read simulated tick seconds separately from absolute reward timestamps and session wall time, including large-clock rounding and legacy stop-record fallback. Remove superseded OpenTUI/React dependency claims from the pending release notes after the Gunshi migration. — Thanks @imjlk!
- [fa0fbd8](https://github.com/imjlk/idlekit/commit/fa0fbd898210cd4cfdc24ceda73947299493d82a) Validate strategy structure, registered ids, explicit parameters, and factory defaults before recommending simulation. Registry-aware scenario validation remains optional and does not construct plugin strategies. — Thanks @imjlk!
- [7a40e57](https://github.com/imjlk/idlekit/commit/7a40e5742db366d485fa771ff4ca22cd6f032361) Keep economy counters independent of event retention and fast money-event omission.
  
  - observation counts money facts even when the retained log omits them
  - `observation.enabled: false` reports missing counters and null rates
  - session stats merge child observations, including a cross-boundary reward gap
  - a legacy event fallback stays incomplete and does not present a summed observation
  - trace and action-row budgets are separate from the event log
  - milestone and goal caps mark coverage partial
  - a throwing observer becomes `ObservationError` and is not a successful run
  - `idlekit.run-observation` is not registered with a contract generator; that waits until TC-05 — Thanks @imjlk!
- [58b42e4](https://github.com/imjlk/idlekit/commit/58b42e45b28e77602cea6e376908c412ce6cdffa) Start each independent trial from its own model, strategy cursor, and vars.
  
  - `createRunFactory` distinguishes fresh, continue, and resume
  - a fresh Monte Carlo draw restores `snapshotState` or builds a new factory instance
  - continue keeps the strategy cursor and the same model instance
  - resume restores the existing strategy snapshot and does not add fields to `SimStateJSON`
  - `compileScenario` copies `initial.vars` with `deepClonePreservingPrototype`
  - execution and preview RNG streams are derived from the logical trial id and are not mixed
  - a stateful closure with no factory and no snapshot hooks throws `RunIsolationError`
  - deep-cloning a function closure is not isolation
  - `ExecutionPlan` and `RunCheckpoint` are not registered with a contract generator; that waits until TC-05 — Thanks @imjlk!
- [548c633](https://github.com/imjlk/idlekit/commit/548c6335a1151071ad464f4e617a8772d58555a2) Preserve first milestone, action, and committed prestige times when observation samples reach their retention cap, including across active and offline session segments. Older observations continue to use their retained samples. — Thanks @imjlk!
- [372d92a](https://github.com/imjlk/idlekit/commit/372d92a1609c718551da20ba9d7413ba7ad3f74b) Keep evaluate stages on one resolved run plan.
  
  - one compile feeds a fresh simulate, experience, and ltv instance
  - `--strategy` accepts a registered id and reaches all three stages
  - `--step` and `--fast` stay on simulate and ltv unless `--consistent-overrides` is set
  - the default engine remains `number`; `scenario.engine` is metadata
  - `breakInfinity` can be selected explicitly; `breakEternity` stays unsupported
  - amount goals use `parseMoney` on the amount path
  - strategy params stay legacy-raw unless validated mode is requested
  - `scenarioHash` stays the original scenario; `effectiveRunHash` omits time and absolute paths
  - `simulate` and `evaluate` no longer use the scenario path for the default seed, so a run without `--seed` gets a new seed and matches a copy in another directory
  - the default `evaluate` seed reads only the scenario, strategy, and engine, so a stage-only flag such as `--step` no longer changes the experience seed or digest; `--seed` still reaches every stage
  - `idlekit.resolved-run-configuration` is not registered with a contract generator; that waits until TC-05 — Thanks @imjlk!
- [4e0acc0](https://github.com/imjlk/idlekit/commit/4e0acc00b10f52db82284ffcdd93f1143f0d12ba) Stop online and offline runs on the economic horizon instead of stepping past it.
  
  - the last tick is `min(stepSec, time still inside duration)`
  - a duration or `until` that is already true completes before `maxSteps` is treated as a failure
  - `maxSteps` with a requested horizon returns `stop.reason: "budget"` and keeps the state
  - `maxSteps` alone still throws; that remains the guard for a loop with no horizon
  - offline no longer throws away a run whose planned steps exceed `maxSteps`
  - each tick copies `ctx` and sets `stepSec` to that tick's `dt`
  - action events are stamped at the start of the tick; money and milestone events are stamped after income
  - the trace keeps the first state and the final state without duplicating the final point
  - constant income is the only case treated as exact across different step sizes
  - runs whose duration was not a multiple of `stepSec` change, because the old overshoot was the bug
  - `stop` is in-memory only and is not added to the CLI simulate wire schema
  - `RunStop` is not registered with a contract generator; that waits until TC-05 — Thanks @imjlk!
- [13d77c9](https://github.com/imjlk/idlekit/commit/13d77c9258b42b93ab68265b30c62019994620b9) Refresh Zod, AJV, YAML, and Bun/Node types. Align the development and CI toolchain with Bun 1.4.2 and Node 26.11.1, update setup-bun and publishing npm, and use Bun executable shims for Windows compiler tooling. Keep the ttsc-compatible typia 14.0.6 pin. — Thanks @imjlk!
- [6873fba](https://github.com/imjlk/idlekit/commit/6873fba3d0e2fc3e9a5791eab7d65c99b70c6e36) Keep session wall time off the reward clock.
  
  - a capped or decayed absence does not start the next active block early
  - reports name wall elapsed, reward time, and active time separately
  - `state.t` still advances only by simulated reward seconds
  - offline actions default to `legacy-all`; `none` does not call `decide`
  - `allow` keeps listed action kinds and optional actors
  - an empty, negative, or overlapping offset schedule is rejected
  - `until`, or reaching every goal, stops later blocks
  - `maxSteps` is a per-block budget; a cut block is counted in `summary.budgetStops` and the session continues
  - `idlekit.session-clock` is not registered with a contract generator; that waits until TC-05 — Thanks @imjlk!
- [b870b1a](https://github.com/imjlk/idlekit/commit/b870b1a820374323991c3547eadef0dd74bbc86f) Pin development toolchain dependencies for the ttsc compatibility baseline.
  
  - pin `@idlekit/core` `typia` to `14.0.6`, the release that matches `@ttsc/graph@0.30.4`
  - simulation results and CLI flags are unchanged — Thanks @imjlk!
- [403f55f](https://github.com/imjlk/idlekit/commit/403f55f884e3c67210fe8b0b3e723201e28fdf2f) Close the recurring correctness gaps from the #156 review.
  
  - default seeds and `effectiveRunHash` come from one resolved run identity, so equivalent flags, paths, and save metadata give the same seed, run id, and digest
  - default run ids no longer read the scenario path; existing run ids and stage digests change, while no-flag default seeds stay the same
  - session observation caps, drop counts, and observer notifications cover the whole session; a session `until` reads a copy of the state
  - a shared snapshot strategy has one cursor owner across bindings; a resume that cannot restore its checkpoint throws `RunIsolationError`
  - durations are tick seconds instead of `end.t - start.t`, which rounds at a large start time
  - a non-finite or non-numeric `state.t`, a non-finite analytic ETA input, and an oversized or non-advancing prestige-cycle scan are rejected
  - growth refuses a cut trace and does not draw a segment across a non-finite point; a partial milestone report no longer reads a dropped key or a missing first milestone as unreached
  - simulate `totalElapsedSec` sums tick durations across online, offline, and newly saved resume segments; legacy saves retain their timestamp-offset fallback
  - action logs carry tick elapsed time across bounded logs and session segments, and ltv `timeToFirstUpgradeSec` uses it from the analysis start — Thanks @imjlk!
- [82383cc](https://github.com/imjlk/idlekit/commit/82383cc4e148c18a77c3c33ccb13b06cd516946c) Persist the most recent committed prestige reset time in simulation state metadata and restore the cooldown when resuming online or with offline catch-up. Include that anchor in the effective run identity. Older state files remain readable; files without a saved reset time cannot recover the earlier cooldown history. — Thanks @imjlk!
- [cdb504f](https://github.com/imjlk/idlekit/commit/cdb504fefdf0c03e7e3ce010d8997e8d32eddc30) Charge a bulk buy the current quote once instead of the single-action cost.
  
  - omitted `bulkSize` and size `1` still pay `Action.cost` once, then `apply` once
  - a larger integer size re-reads `Action.bulk` and pays that size's `BulkQuote.cost` once
  - `cost: null` stays free
  - missing, duplicate, non-integer, non-finite, negative, and wrong-unit quotes are rejected without paying or applying
  - planner and greedy still choose a size; they do not supply the amount that is charged
  - the linear CLI plugin prices a later buy from ownership so far, and LTV counts invalid-quote skips
  - runs that bought in bulk and paid only the unit price change, because that underpayment was the bug
  - affordability uses exact decimal order, including a huge exponent gap, and does not treat `cmp` or a rounded `toNumber` as exact
  - an engine whose text is not a bare decimal settles only when it implements `exactOrder`
  - greedy `maxAffordable` uses that same exact check — Thanks @imjlk!
- Updated dependencies: money@0.2.0

