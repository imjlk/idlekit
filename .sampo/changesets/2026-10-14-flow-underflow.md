---
npm/@idlekit/core: patch
---

Reject nonzero flow amounts that underflow to zero, and keep underflowed conversions and Little's law products inconclusive.

Losses that round to Number 1 must also spell exactly 1 as a decimal. For example, `0.99999999999999999` was accepted and could turn a positive remaining flow into a total-loss conservation result; it is now rejected, while exact-one spellings such as `1.00` remain accepted. Decimal validation issues now describe the Number representability boundary, including conversion-to-zero underflow.
