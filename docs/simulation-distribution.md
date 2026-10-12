# Simulation distribution

Korean version: [simulation-distribution_ko.md](./simulation-distribution_ko.md)

`analyzeDistribution` summarises fixed draws. Each sample is `observed`, `censored`, `failed`, or `unsupported`. Completion rate is observed divided by observed plus right-censored. A failed or censored sample is not a finished time of zero.

## Population and conditional quantiles

The method is `inclusive-floor-index` version 1. The rank is `floor((n - 1) * q)`. Keys are `q` plus the probability's own text, so rounding to a percent cannot merge `q0.946` and `q0.954`.

The population quantile uses one common horizon. Censored draws sit above that horizon. If the requested rank falls in that tail, status is `outside-observed-range` and the value is null. The completed-only quantile is a separate list labeled `completed-only`. Varying censor times are not a survival estimator. With no common horizon the population value stays unavailable. An observed value past the common horizon is rejected, since a censored draw's rank is then unknown. A sample status other than the four, or a source other than the two, is rejected. A negative first visible time is a failed sample. An observed value must be one the number holds exactly: `"1e3"` is kept as 1000, and `"9007199254740993"` is rejected. Means are summed so finite samples do not overflow, and a variance past the number range is null with a warning. `idk experience` passes the common horizon when every draw observes visible changes until exactly the same reward time, and analyzes each distinct quantile once.

An empty observed set is unavailable. It is not mean `0` and not a zero-second completion.

## Means

`arithmetic-mean`, `mean-of-log10`, and `log10-of-arithmetic-mean` are three slots. Mean of log10 wealth is not reported as mean wealth.

## Seeds and sources

The artifact lists `drawId`, `drawIndex`, and `seed` in logical index order. That order does not depend on worker count. `simulateMonteCarlo` uses the same logical seed. Common random numbers require the execution stream and throw otherwise. This change runs locally and does not add workers.

Uncertainty source is `model-strategy-session`, `monetization`, or `mixed`. A deterministic model may report variance `0`. That is not an error.

`summarizeExperienceMonteCarlo` no longer replaces a missing first visible change with active time or zero. The legacy numeric field averages observed changes only. The attached `firstVisible` artifact keeps the censored draws.

## Canonical example

There is a fixed seed. The drop fixture is [independent-drop.json](../fixtures/conformance/independent-drop.json). Seed `28947`, 10000 draws, probability `0.01`, absolute tolerance `0.005`. One uniform comes from each logical draw. The check is the tolerance, not an exact `0.01`.

The quantile example is the sorted sample `[1, 2, 3, 4, 5]`.

- q0 is `"1"`, q0.5 is `"3"`, q0.95 is `"4"`, q1 is `"5"`
- ninety `"10"` values and ten censored draws on horizon 40 have completion rate `0.9`
- population p95 is null and `outside-observed-range`
- completed-only q0.95 stays `"10"`

Node.js and browser runtimes are not part of the v1 compatibility contract.
