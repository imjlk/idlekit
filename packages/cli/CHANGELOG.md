# @idlekit/cli

## 0.5.1 — 2026-10-17

### Patch changes

- [8fd29af1](https://github.com/imjlk/idlekit/commit/8fd29af11b49bdf7efa5d196fb2f4956cb6a1d79) Expose typed LTV point and seeded uncertainty estimates from the public core SDK. The CLI shares that implementation, with finite input, quantile-key and synchronous work-budget checks. Consumers no longer need private CLI source imports. — Thanks @imjlk!
- Updated dependencies: core@0.5.0

## 0.5.0 — 2026-10-16

### Minor changes

- [c5b7ef2](https://github.com/imjlk/idlekit/commit/c5b7ef2edb78fea448b85f363c1bc4f70bf5ec05) Explain balance targets with `balance --format md`, including measured values, bounds, conditions, and failure reasons. Add explicit observation windows and scenario assumption comparisons to `calibrate`, with installed-user denominators, unobserved retention points, Wilson intervals, and retention-only patches. Withhold patches that conflict with the LTV retention curve and explain what needs review. Make the plugin example portable to npm consumers and consolidate redundant tutorial economies. — Thanks @imjlk!

### Patch changes

- [81a6e50](https://github.com/imjlk/idlekit/commit/81a6e50b52260eb50170ec6d35c6f42cc06b863d) Rebuild the packages with ttsc 0.32.1 and align its lint, Evidence, Graph, and bundler plugins. Update typia to 15.1.0 and refresh generated contract metadata and toolchain integrity pins. Support the separate native Graph packages in toolchain diagnostics. — Thanks @imjlk!
- [e5bdaf0](https://github.com/imjlk/idlekit/commit/e5bdaf0086bd1f573ca9be7fa1b8f0305c91c6c3) Keep exploratory calibration retention curves nonincreasing while preserving raw observations. Reject numeric overflow in calibration estimates and diagnostics before writing a report. — Thanks @imjlk!
- [dcb359e](https://github.com/imjlk/idlekit/commit/dcb359e00a1f183c5053a81c11effea742463043) Protect telemetry and scenario inputs from calibration output writes, including filesystem aliases. Preserve Wilson confidence intervals in cohort CSV reports and enforce retention report ordering, cross-field consistency, and withheld-patch contracts. — Thanks @imjlk!
- [f335ca3](https://github.com/imjlk/idlekit/commit/f335ca3bcc6a77deb2e6f0f2ce50f63fe0126f31) Reject KPI regression output paths that overwrite the baseline or current report, including hardlinks and directory aliases. Preserve separate report and stdout output. — Thanks @imjlk!
- Updated dependencies: @idlekit/core@0.4.1

## 0.4.0 — 2026-10-14

### Minor changes

- [d2af4ce](https://github.com/imjlk/idlekit/commit/d2af4ce319d8af57ab85080dfc36f75d3f6ce82f) Aggregate analysis trials in logical order.
  
  - the default backend stays local and records worker spawn cost as zero
  - a Bun worker pool is explicit, serializes plain task JSON, and sorts results by logical index; no command selects it yet
  - a plugin root or digest is not widened, and a partial batch is not a full distribution — Thanks @imjlk!
- [1a720d5](https://github.com/imjlk/idlekit/commit/1a720d5750657283aec5d3b4668c2b1242dc241e) Keep Jev advice off the numerical verdict.
  
  - an opt-in provider posts an allowlisted projection and keeps Choice, Score, and Noul distinct
  - a provider failure, abstain, or warning stays beside the numerical report
  - the rules judge remains the default and does not call the network — Thanks @imjlk!
- [5d2e719](https://github.com/imjlk/idlekit/commit/5d2e7194c5f6dff7edc455eadacc9eab54c71d8f) Judge scenario metrics with a balance check file.
  
  - `idk evaluate --checks` compares a registered metric, operator, threshold, and unit
  - a missing or unknown metric does not pass as zero, and a mismatch is not rewritten into the baseline
  - `idk kpi regress` keeps its flags and maps the same rows through that check — Thanks @imjlk!
- [3770995](https://github.com/imjlk/idlekit/commit/37709952510cf47afacedc5c8be5ed867751ef61) Advise on a finished analysis artifact with a rules rubric.
  
  - `idk judge --provider rules` reads an analysis artifact and a versioned rubric
  - numeric thresholds stay on the balance-check engine and are not rewritten
  - an estimate or a missing metric does not become a measured pass — Thanks @imjlk!

### Patch changes

- [539ca70](https://github.com/imjlk/idlekit/commit/539ca70947424ea271cbfbe058ed48ff123730cf) Record the selected integration scope and check small answers by hand.
  
  - flow, guarded advance, Jev, and worker execution stay optional capabilities
  - breakEternity stays unsupported
  - this change does not publish to npm — Thanks @imjlk!
- Updated dependencies: core@0.4.0

## 0.3.1 — 2026-10-13

### Patch changes

- [1199851](https://github.com/imjlk/idlekit/commit/1199851de5d9ab38600ecbc0cb3bb1b7431535a6) Add measured-condition follow-up checks to experience and comparison Markdown reports. Label the recorded session separately from Monte Carlo draw accounting, preserve unresolved population timings, and guide metric tradeoffs without changing JSON decisions. — Thanks @imjlk!
- Updated dependencies: core@0.3.1

## 0.3.0 — 2026-10-12

### Minor changes

- [71504bd](https://github.com/imjlk/idlekit/commit/71504bd4169e1db7212f99471da5295bf021c239) Register growth and ETA analyzers without a second numeric engine.
  
  - `idk analyze <id>` runs a registered analyzer and keeps `idk eta`, `idk growth`, and `idk prestige-cycle`
  - a short observation returns insufficient-data instead of a silent long run
  - plugin analyzers still require the existing allow, root, and sha256 checks — Thanks @imjlk!
- [3d98c35](https://github.com/imjlk/idlekit/commit/3d98c35c3897aec8004b8ff7c296d991439fa37b) Explain a resolved run plan before it starts.
  
  - `idk inspect` reports the engine, stage step, horizon, and capability knowledge without a tick
  - a planner expansion is an upper bound, and a wide number-engine decimal is a warning
  - plugin modules stay unloaded unless `--resolve-plugins` passes the existing trust checks — Thanks @imjlk!

### Patch changes

- [bb36b82](https://github.com/imjlk/idlekit/commit/bb36b8236d9e07f0605e3d24028f993155347500) Correct ETA goal meaning without replacing the legacy seconds field.
  
  - large ratios are divided in the Engine before a finite seconds number
  - exact is not implied by a constant-income hint when a boundary exists
  - a missed horizon is censored on the new estimate and still numeric on the legacy field — Thanks @imjlk!
- [1c922e1](https://github.com/imjlk/idlekit/commit/1c922e1ee361f4a193d012e5b1a463e60a1aea1f) Compare registered model and policy parameters with local one-at-a-time experiments.
  
  - `idk experiment <spec>` is a new command and does not replace `idk tune`
  - censored reach times stay null instead of the horizon
  - Pareto does not treat an unknown objective as a better point
  - candidates start from the referenced scenario, run to the horizon, and average every seed — Thanks @imjlk!
- [1f9d87c](https://github.com/imjlk/idlekit/commit/1f9d87c1f66255b191403af63b6909a2727877f8) Report censored simulation draws separately from completed quantiles.
  
  - population p95 stays unavailable when the common horizon does not cover it
  - experience no longer fills a missing first visible change with active time or zero
  - logical draw seeds do not depend on worker count — Thanks @imjlk!
- [38c9836](https://github.com/imjlk/idlekit/commit/38c98360e701bb087295b59825fe51f3ccd74537) Keep ETA validity and exactness aligned with engine comparison and wallet settlement.
  
  - reject positive ETA ratios lost to zero during engine division
  - reject income in a different wallet or target unit
  - expose optional Engine comparisonIsExact metadata and keep tolerant or unknown comparisons analytic-local
  - preserve legacy seconds while limiting exact labels and reach brackets to declared strict comparators — Thanks @imjlk!
- [24ef572](https://github.com/imjlk/idlekit/commit/24ef572763f63395a9e1bae2c2dcaf7f89753c82) Add analysis artifact v1 without replacing ScenarioV1 or CLI metadata.
  
  - money, net worth, prestige points, and milestone goals share one predicate
  - model capabilities are registered outside Model and do not score missing flow as zero
  - contracts:check compares the generated artifact schema and does not rewrite it
  - CLI output keeps contractVersion 1.4.0 and links the artifact beside _meta — Thanks @imjlk!
- Updated dependencies: core@0.3.0

## 0.2.1 — 2026-10-11

### Patch changes

- [c915f08](https://github.com/imjlk/idlekit/commit/c915f0831f7bfe884e57e9411c992a91053a781d) Publish registry metadata with concrete internal dependency versions.
  
  - `@idlekit/core@0.2.0` and `@idlekit/cli@0.2.0` were published with `workspace:*` in their registry dependencies, so npm and Bun could not install them; their tarballs already named `0.2.0`
  - the release rewrites every package manifest before Sampo's dry run and real publish, and restores it afterwards, because npm sends the manifest it read before `prepack`
  - package contents, exports, and CLI behavior are unchanged — Thanks @imjlk!
- [2e86c9e](https://github.com/imjlk/idlekit/commit/2e86c9e2d612fa55ad8b1d64d96d3305bd404988) Load a plugin reached through a symlinked directory even when its file was created after a sibling plugin in that directory was loaded in the same process.
  
  - import each plugin by its realpath; Bun already names the module by it, and `pluginDigest` stays keyed by the resolved path that was passed — Thanks @imjlk!
- Updated dependencies: core@0.2.1

## 0.2.0 — 2026-10-09

### Minor changes

- [18f658a](https://github.com/imjlk/idlekit/commit/18f658a1306f03d438efb8e814ba8b539a88a233) Add a reusable typed CSV balance workflow with deterministic pacing and sensitivity checks.
  
  - `idk balance` validates numeric IDs and units, materializes a scenario, and publishes result CSV/JSON with provenance
  - atomic generation publication and freshness checks protect against stale or concurrently edited inputs
  - bounded pacing checks distinguish breaches, unreached milestones, and errors using explicit seeds, strategy, and horizon
  - optional `exportVariants` publishes a deterministic scenario manifest and executable sensitivity scenarios inside the checked, atomic bundle while preserving the default five outputs
  - add a tiny public linear example handing exported scenarios to existing simulate, compare, strategy tuning, and offline-session analysis commands
  - document numeric-only sheet fields, strategy overrides, seed and Monte Carlo boundaries, and the separation between pacing and offline/session horizons
  - add synthetic contract fixtures and regression coverage without shipping game-specific balance data — Thanks @imjlk!
- [52cdc04](https://github.com/imjlk/idlekit/commit/52cdc04d1aea2f52747407bc3661b573532dbdb9) Use Gunshi for native command trees, strict options, help/version, four-shell completion, and typo suggestions. Keep Zod validation, report formats, trust controls, and Clack wizards. Replace OpenTUI dashboards with Markdown review aliases and remove Bunli, OpenTUI, React, and image-preview dependencies. Image-mode/protocol flags no longer apply. — Thanks @imjlk!
- [9f28ee9](https://github.com/imjlk/idlekit/commit/9f28ee9537eb5d7b8bae0ae0c5e39cad16a16dda) Require Bun >=1.4.2 for all packages. Upgrade the Bun runtime and CI pins before installing this release, or retain an already installed previous package version and lockfile until the runtime can be upgraded. Follow the migration guide at https://github.com/imjlk/idlekit/blob/main/docs/bun-14-migration.md. — Thanks @imjlk!
- [ba8ad1f](https://github.com/imjlk/idlekit/commit/ba8ad1ff2d644ac9f7b2d99abee13ddd47a5f465) Add a design-decision analysis layer on top of the deterministic economy simulator.
  
  - add worth-aware growth analysis, milestone analysis, session-pattern simulation, and core Monte Carlo helpers in `@idlekit/core`
  - add the `idk experience` command for pacing, milestone, and perceived progression evaluation
  - extend compare/report/KPI flows with design-facing metrics such as milestone timing, visible progression rate, and no-reward gaps
  - document `design` and `analysis.experience` scenario fields and update tutorial/template flows around session patterns and experience checks — Thanks @imjlk!
- [eadc50f](https://github.com/imjlk/idlekit/commit/eadc50fc53ecb25d76e336161c11469b9489eda2) Make experience and comparison Markdown reports easier to use for design decisions.
  
  - display capped milestone coverage and retained-independent first times, plus recorded final prestige state
  - list the longest sampled stall and softcap windows and explain their sampling and active-time budgets
  - present comparison metrics and opposing strategy preferences in a table, including warnings and unreached scoring penalties
  - report Monte Carlo visible-progression and reward-gap aggregates consistently with the values used for comparison
  - keep exact milestone-key comparisons separate from independent first-action/prestige summary facts and require complete key coverage — Thanks @imjlk!

### Patch changes

- [cb9b1ef](https://github.com/imjlk/idlekit/commit/cb9b1ef41a4d645e1a01c7e9c8a391ff5d3db39e) Keep report experience sections and tuning design objectives independent of earlier economy runs. Rebuild candidate models and strategies per seed, analysis run, and Monte Carlo draw while preserving the candidate parameters and run overrides. Validate candidate parameters before running and refuse a declared stateful model without a factory source. — Thanks @imjlk!
- [5ce2b54](https://github.com/imjlk/idlekit/commit/5ce2b54aa9b9495382c495d7ac74e3e5dbaefb6f) Value report timeline net worth from each selected snapshot's holdings, falling back to its current wallet rather than historical peak money. — Thanks @imjlk!
- [30aa4e2](https://github.com/imjlk/idlekit/commit/30aa4e2609fe19bc0b502c28aafb16954bfe5783) Preserve existing dependency resolutions when preparing package releases. CI and `release:version` now refresh only workspace version metadata, reject other lockfile changes, and verify a frozen install. Dependency upgrades remain separate reviewed changes. — Thanks @imjlk!
- [b741eb1](https://github.com/imjlk/idlekit/commit/b741eb12909ed15fae5026c82e06f71676a8a4ac) Document how consumers read simulated tick seconds separately from absolute reward timestamps and session wall time, including large-clock rounding and legacy stop-record fallback. Remove superseded OpenTUI/React dependency claims from the pending release notes after the Gunshi migration. — Thanks @imjlk!
- [7bbaf97](https://github.com/imjlk/idlekit/commit/7bbaf977429d30a4e93589b6baa5320272b0327d) Route package check and money/core emit through ttsc, and stop treating an unresolved typia generic as a user-input error.
  
  - `typiaStandardSchema()` now throws `TypiaTransformMissingError`. That breaks callers who caught a failed Standard Schema result, so core is a minor bump while the package is still `0.x`: `^0.1.0` does not take `0.2.0`. A v1 major stays off until the release-process migration gates are ready. Callers that still want a failed result use `standardSchemaFromValidate()`.
  - add `standardSchemaFromValidate()`, `ConcreteQuota`, `validateConcreteQuota`, and `concreteQuotaSchema`
  - CLI flags and the `#!/usr/bin/env bun` shebang are unchanged — Thanks @imjlk!
- [fa0fbd8](https://github.com/imjlk/idlekit/commit/fa0fbd898210cd4cfdc24ceda73947299493d82a) Validate strategy structure, registered ids, explicit parameters, and factory defaults before recommending simulation. Registry-aware scenario validation remains optional and does not construct plugin strategies. — Thanks @imjlk!
- [b5310ad](https://github.com/imjlk/idlekit/commit/b5310ad42805211a52ccee371e342464ceed30ec) Make `--fast false` and `--no-fast` disable a scenario's fast mode. Omitting the flag preserves the scenario setting; explicit true enables it. Apply the same rule to simulate, ltv, compare, eta, and evaluate, and derive execution hashes and default seeds from the effective mode while preserving evaluate's stage scopes. — Thanks @imjlk!
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
- [60fae65](https://github.com/imjlk/idlekit/commit/60fae6502fc4d47b154453b31df7891d81715204) Keep compare measurements independent when a strategy or model holds mutable state.
  
  - construct a fresh model and strategy for economy, ETA, and each design measurement
  - reconstruct plugin models and strategies for every Monte Carlo draw
  - validate strategy override defaults using the same legacy-raw schema path as scenario strategies — Thanks @imjlk!
- [07b05fe](https://github.com/imjlk/idlekit/commit/07b05fe306bd163e319fcab8a6068c2750908e5f) Validate the complete CLI test suite and release/toolchain TypeScript on Windows CI. Path assertions now accept Windows absolute paths, directory alias security checks use junctions on Windows, and file symlink tests run when permissions allow them. The large-clock session regression isolates its active ticks so it finishes within the default test timeout; failed Evidence inventory runs now include their test output. — Thanks @imjlk!
- [8f4fd54](https://github.com/imjlk/idlekit/commit/8f4fd54e8ee10657ac3e049d1cbfd6178ba21a25) Keep linear model costs, bulk income, and inventory value in the selected money engine instead of converting amounts to Number. Large exponential economies remain usable with breakInfinity; Number overflow now produces an error with engine guidance instead of a successful non-finite report. — Thanks @imjlk!
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
- [58b975b](https://github.com/imjlk/idlekit/commit/58b975ba18946109e019a300b21259023a52a40f) Show command help without executing handlers, render Markdown reports as Markdown, identify unwritable output paths, and label evaluate's game asset values separately from modeled LTV per user with conversion and retention guidance. — Thanks @imjlk!
- Updated dependencies: core@0.2.0

## 0.1.1 — 2026-03-07

### Patch changes

- 4e08060 Standardize v1 CLI governance around canonical template scaffolds, typed error codes,
  compare/tune insight payloads, and verified onboarding/replay workflows. — Thanks imjlk!

