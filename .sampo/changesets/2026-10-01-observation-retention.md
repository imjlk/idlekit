---
npm/@idlekit/core: patch
---

Keep economy counters independent of event retention and fast money-event omission.

- observation counts money facts even when the retained log omits them
- `observation.enabled: false` reports missing counters and null rates
- session stats merge child observations, including a cross-boundary reward gap
- a legacy event fallback stays incomplete and does not present a summed observation
- trace and action-row budgets are separate from the event log
- milestone and goal caps mark coverage partial
- a throwing observer becomes `ObservationError` and is not a successful run
- `idlekit.run-observation` is not registered with a contract generator; that waits until TC-05
