---
npm/@idlekit/core: minor
npm/@idlekit/cli: patch
---

Report censored simulation draws separately from completed quantiles.

- population p95 stays unavailable when the common horizon does not cover it
- experience no longer fills a missing first visible change with active time or zero
- logical draw seeds do not depend on worker count
