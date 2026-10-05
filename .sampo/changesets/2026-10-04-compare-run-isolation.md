---
npm/@idlekit/cli: patch
---

Keep compare measurements independent when a strategy or model holds mutable state.

- construct a fresh model and strategy for economy, ETA, and each design measurement
- reconstruct plugin models and strategies for every Monte Carlo draw
- validate strategy override defaults using the same legacy-raw schema path as scenario strategies
