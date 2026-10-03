---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Keep session wall time off the reward clock.

- a capped or decayed absence does not start the next active block early
- reports name wall elapsed, reward time, and active time separately
- `state.t` still advances only by simulated reward seconds
- offline actions default to `legacy-all`; `none` does not call `decide`
- `allow` keeps listed action kinds and optional actors
- an empty, negative, or overlapping offset schedule is rejected
- `until`, or reaching every goal, stops later blocks
- `maxSteps` is a per-block budget; a cut block is counted in `summary.budgetStops` and the session continues
- `idlekit.session-clock` is not registered with a contract generator; that waits until TC-05
