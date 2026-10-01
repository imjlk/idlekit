---
npm/@idlekit/core: patch
---

Compare reset intervals with a measured recovery time and an empirical stability report.

- committed reward stays separate from the uncommitted tail and from opening stock
- recovery is a threshold crossing or censored, not `min(interval, horizon)`
- stability uses windows and tolerances, and it does not prove a steady state
