---
npm/@idlekit/core: patch
---

Stop online and offline runs on the economic horizon instead of stepping past it.

- the last tick is `min(stepSec, time still inside duration)`
- a duration or `until` that is already true completes before `maxSteps` is treated as a failure
- `maxSteps` with a requested horizon returns `stop.reason: "budget"` and keeps the state
- `maxSteps` alone still throws; that remains the guard for a loop with no horizon
- offline no longer throws away a run whose planned steps exceed `maxSteps`
- each tick copies `ctx` and sets `stepSec` to that tick's `dt`
- action events are stamped at the start of the tick; money and milestone events are stamped after income
- the trace keeps the first state and the final state without duplicating the final point
- constant income is the only case treated as exact across different step sizes
- runs whose duration was not a multiple of `stepSec` change, because the old overshoot was the bug
- `stop` is in-memory only and is not added to the CLI simulate wire schema
- `RunStop` is not registered with a contract generator; that waits until TC-05
