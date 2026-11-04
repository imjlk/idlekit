---
npm/@idlekit/money: patch
---

`formatMoney` carries a mantissa that rounds to 1000 into the next suffix (`999.9` is `1aa`, not `1.00e+3`), keeps plain digits when `significantDigits` is smaller than the integer part, stays on the last `table` suffix instead of printing a wrong small value, keeps the sign of tiny negative values, trims exponent forms, and rejects `significantDigits` outside 1 to 100 or not an integer. `parseMoney` prefers an exact `table` suffix over a case-insensitive one. `createNumberEngine().from` rejects blank and non-numeric strings instead of returning 0 or `NaN`, and `cmp(Infinity, Infinity)` is 0. `deserializeMoneyState` checks that `unit`, `amount`, and `bucket` are strings.
