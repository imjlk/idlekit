---
npm/@idlekit/core: patch
---

Separate growth shape from legacy log-slope buckets.

- slow and fast exponentials share a shape and keep different speeds
- zero, negative, and short traces are not reported as a speed claim
- the existing growth report and net-worth fallback stay in place
