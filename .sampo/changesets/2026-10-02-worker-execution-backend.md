---
npm/@idlekit/cli: minor
npm/@idlekit/core: minor
---

Aggregate analysis trials in logical order.

- the default backend stays local and records worker spawn cost as zero
- a Bun worker pool is explicit, serializes plain task JSON, and sorts results by logical index; no command selects it yet
- a plugin root or digest is not widened, and a partial batch is not a full distribution
