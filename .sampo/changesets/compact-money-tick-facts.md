---
npm/@idlekit/money: minor
npm/@idlekit/core: minor
---

Allow money ticks to return compact counts and applied/flushed amounts without retaining events. Fast simulations and planner previews use these facts to preserve observation counters and reward gaps while avoiding discarded event objects. Reuse each policy's computed precision gap for its threshold check.
