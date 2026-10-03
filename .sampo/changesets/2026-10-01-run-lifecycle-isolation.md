---
npm/@idlekit/core: patch
---

Start each independent trial from its own model, strategy cursor, and vars.

- `createRunFactory` distinguishes fresh, continue, and resume
- a fresh Monte Carlo draw restores `snapshotState` or builds a new factory instance
- continue keeps the strategy cursor and the same model instance
- resume restores the existing strategy snapshot and does not add fields to `SimStateJSON`
- `compileScenario` copies `initial.vars` with `deepClonePreservingPrototype`
- execution and preview RNG streams are derived from the logical trial id and are not mixed
- a stateful closure with no factory and no snapshot hooks throws `RunIsolationError`
- deep-cloning a function closure is not isolation
- `ExecutionPlan` and `RunCheckpoint` are not registered with a contract generator; that waits until TC-05
