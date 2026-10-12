# ETA numeric and goal semantics

## Engine ratio {#req-pr09-engine-ratio}

Requirement `REQ-PR09-ENGINE-RATIO`. `PR-09` owns it.

`etaEngineRatio` is `engine-divn-before-number`. `etaSecondsFromEngineRatio` computes `E.divN(E.sub(target, current), rate)` and calls `Engine.toNumber` only on that ratio, and only when the ratio is finite and its absolute log10 is not above 308. A break-infinity gap of `1e402` over income `1e400` is 100 seconds. It is not `NaN` and not `Infinity/Infinity`. A finite ratio that does not fit in a number has `seconds: null`, status `invalid`, and `secondsDecimal`.

`etaGoalForTarget` parses money and net worth with one `parseMoney` suffix parser. Analytic and simulate estimates share that goal id. There is no RNG. Amounts are literals. The break-infinity fixture uses income `1e400` and target `1e402`.

## Exact or local {#req-pr09-exact-local}

Requirement `REQ-PR09-EXACT-LOCAL`. `PR-09` owns it.

`etaExactOrLocal` is `exact-or-analytic-local`. `method: "exact"` requires money, `incomeKind: "constant"`, an Engine declaring `comparisonIsExact: true`, and no action, evolve, prestige, strategy, or policy constraint. A tolerant or undeclared comparison keeps the legacy ratio but is `analytic-local`, because the goal may be met before the literal threshold. The strict-comparison fixture uses epsilon 0. `incomeKind: "constant"` with an action is `analytic-local`, not high confidence. A model `netWorth` function is `unsupported` and `unsupported-local`. Money income is not used as that derivative. A missing `netWorth` is also `unsupported-local`. Its legacy `seconds` may still reuse wallet money. A requested `fallback` records `localMethod`, `fixedStepMethod`, both seconds, and `diffSec`.

Constant non-positive income is `unsupported`. A negative rate that is not a confirmed constant is `insufficient-data`. Prestige keeps the estimate `analytic-local` and omits a bracket.

## Censored observation {#req-pr09-censored-observation}

Requirement `REQ-PR09-CENSORED-OBSERVATION`. `PR-09` owns it.

`etaCensoredObservation` is `censored-fixed-step`. Income 1 and money target 3 take 3 seconds. A target already met at t=0 takes 0 seconds. Horizon 10 and target 999 are status `censored`, artifact `seconds: null`, and legacy `seconds` 10. The artifact does not say unreachable. Fixed-step `seconds` are the first observation. A monotonic constant model may include a bracket from the continuous ratio to that observation. A prestige model records `observationResolutionSec` and no bracket. Legacy `eta.output.schema.json` still types `seconds` as a number. `readEtaOutput` keeps that number apart from artifact `seconds`.

No RNG. The number-engine fixture uses `stepSec` 1.
