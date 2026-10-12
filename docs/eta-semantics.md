# ETA semantics

Korean version: [eta-semantics_ko.md](./eta-semantics_ko.md)

`PR-09` keeps the legacy ETA object and adds an ETA estimate beside it. `docs/schemas/eta.output.schema.json` still requires numeric `seconds`. The estimate may use `seconds: null`.

## Meaning

Money and net worth targets share `etaGoalForTarget`. Analytic and simulate modes use that goal. `exact` is only a constant money derivative with no action, evolve, prestige, strategy, or policy constraint. Anything else that still has a local rate is `analytic-local`. `incomeKind: "constant"` does not by itself make every strategy exact.

An exact estimate also requires `Engine.comparisonIsExact: true`. Built-in engines declare it only with epsilon 0. Their default epsilon and custom comparators without a declaration keep the legacy ratio as `analytic-local`; a tolerant goal can be met before that ratio, so no reach bracket is claimed. Income in a different wallet or target unit is `invalid`. If engine division loses a positive gap to zero, the estimate is `invalid` and does not store that zero as a decimal result.

A model `netWorth` function is `unsupported-local`. Money income is not its derivative. The legacy `seconds` field may still carry the old initial-income ratio when that ratio is a finite number, and that number is not a net worth result. A missing net worth function is also `unsupported-local`. Its legacy `seconds` may reuse wallet money.

Fixed-step `seconds` are the first observation. A monotonic constant model can add a bracket from the continuous ratio to that observation. Other traces record `observationResolutionSec` and do not invent a bracket. A goal still inside the horizon is `censored`. It is not called unreachable. Legacy `seconds` stay on the horizon number.

The ratio is `E.divN(E.sub(target, current), rate)`. `toNumber` runs only after that, and only for a finite representable seconds count. `readEtaOutput` keeps legacy `seconds` apart from the artifact.

The earlier fail-closed rules stay. A run that stops on `maxSteps` before the target or the horizon throws, and observed seconds are the simulated seconds, not the `t` difference. A non-finite wallet, net worth, target, or income is not reached at t=0. A money estimate is then `invalid`, a net worth estimate stays `unsupported`, and legacy `seconds` is `Infinity` with low confidence.

Each estimate records its `target` as kind, engine decimal, and unit, so estimates for different thresholds stay distinct. A `maxLogGap` tick policy can drop or hold income, and a pending `accumulate` bucket flushes on the next tick, so either blocks `exact`. A positive ratio below the number range is `invalid` with `secondsDecimal`, not zero seconds. In simulate mode a non-finite threshold or observed amount never ends the run as the goal and the estimate is `invalid`. A net worth target without `Model.netWorth` is `unsupported` on the estimate, even though legacy fields keep the wallet proxy. Every non-ok estimate has `seconds: null`.

`DX-02` may wrap these functions. It does not add another ETA engine.

Node.js and browser runtimes are not part of the v1 compatibility contract.
