---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Persist the most recent committed prestige reset time in simulation state metadata and restore the cooldown when resuming online or with offline catch-up. Include that anchor in the effective run identity. Older state files remain readable; files without a saved reset time cannot recover the earlier cooldown history.
