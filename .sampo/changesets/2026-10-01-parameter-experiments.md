---
npm/@idlekit/core: minor
npm/@idlekit/cli: patch
---

Compare registered model and policy parameters with local one-at-a-time experiments.

- `idk experiment <spec>` is a new command and does not replace `idk tune`
- censored reach times stay null instead of the horizon
- Pareto does not treat an unknown objective as a better point
