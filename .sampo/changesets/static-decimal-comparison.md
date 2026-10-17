---
npm/@idlekit/core: patch
---

Compare static monetary scenario values exactly as decimal strings, preserving ordering across number overflow, underflow, negative values and high-precision mantissas. Static monetary detail scores retain their original strings instead of mixing raw numbers with logarithms; measured comparisons are unchanged. Invalid decimal amounts now fail explicitly.
