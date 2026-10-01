---
npm/@idlekit/core: patch
---

Keep the planner's first wait, and keep rollout off the live state.

- a leading wait stays a wait, so `decide()` returns no action for that step
- rollout uses `stepOnce` on a cloned state and does not call the live emitter
- `minPrestigeIntervalSec` shares one cooldown decision with the committed step
- a missing last reset is unanchored and is not rewritten as a past time
- the checkpoint records a committed reset time and omits it for a legacy resume
- beam, horizon, branching, and rollout budget are capped
- the search report is not a global optimum
- `idlekit.prestige-cooldown` and `idlekit.planner-search` are not registered with a contract generator; that waits until TC-05
