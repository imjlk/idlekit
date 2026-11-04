# `exponential` model

Korean version: [exponential_ko.md](./exponential_ko.md)

One generator. Each level adds more income than the one before, and each level costs more than the one before. It is the classic idle "building" curve, declared in JSON.

```json
"model": {
  "id": "exponential",
  "version": 1,
  "params": {
    "idleIncome": "1",
    "baseIncome": "1.5",
    "growthRate": 1.04,
    "costBase": "15",
    "costGrowth": 1.12,
    "maxLevel": 150,
    "softCap": { "kind": "pow", "startsAt": "2000", "strength": 0.6 }
  }
},
"initial": { "vars": { "level": 0 } }
```

## Params

| Field | Default | Meaning |
| --- | --- | --- |
| `idleIncome` | `"1"` | Income per second at level 0 |
| `baseIncome` | `"1"` | Income the first level adds |
| `growthRate` | `1.07` | Each level adds `growthRate` times what the previous one added. `1` is a linear generator |
| `costBase` | `"10"` | Price of the first level |
| `costGrowth` | `1.15` | Each level costs `costGrowth` times the previous one |
| `maxLevel` | none | Purchases stop here |
| `softCap.kind` | `"pow"` | `pow`, `sqrt`, or `log` |
| `softCap.startsAt` | required | Production above this is compressed |
| `softCap.strength` | `0.5` | `(0, 1]`. Exponent for `pow`, slope for `log`. Ignored by `sqrt` |

Vars: `level` (default `0`).

## Formulas

With `g = growthRate`, `L = level`, and prestige multiplier `m`:

- raw production `P(L) = idleIncome + baseIncome * (g^L - 1) / (g - 1)`, or `idleIncome + baseIncome * L` when `g = 1`
- soft cap above `S = startsAt`: `pow` gives `S * (P/S)^strength`, `sqrt` gives `S * (P/S)^0.5`, `log` gives `S * (1 + strength * ln(P/S))`
- income per second `= softcapped P(L) * m`
- price of level `L + 1`: `costBase * costGrowth^L`. A bulk of `n` costs the geometric sum `costBase * costGrowth^L * (costGrowth^n - 1) / (costGrowth - 1)`
- net worth `= wallet + total price paid for the current levels`

Large exponents are computed in log space, so `growthRate: 2` at level 2000 stays finite on `breakInfinity`.

## Actions and milestones

- `buy.generator` (kind `buy`): bulk sizes 1, 10, 25, and 100, clipped to `maxLevel`. Each quote carries the exact income change, soft cap and multiplier included.
- Milestones: `exponential.level-10`, `-25`, `-50`, `-100`, `-250`, `-500`, `-1000`, `exponential.max-level`, and `exponential.softcap-reached`.

## Analysis hooks

- `analytic` reports `incomeKind: "linear"` with generator hints when `growthRate` is `1` and there is no soft cap, so the exact ETA can use the closed form. Otherwise it reports `incomeKind: "custom"` with `costExp` and the soft cap.
- The model has no `evolve`, so the guarded advance and the exact ETA accept it.
- `exponentialLevelIncrement(E, params, level)` returns the next level's raw increment for tables.

## Try it

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/26-exponential-forge-v1.json --format md
bun run --cwd packages/cli dev -- growth ../../examples/tutorials/26-exponential-forge-v1.json --format md
```

Node.js and browser runtimes are not part of the v1 compatibility contract.
