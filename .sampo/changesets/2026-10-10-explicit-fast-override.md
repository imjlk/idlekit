---
npm/@idlekit/cli: patch
---

Make `--fast false` and `--no-fast` disable a scenario's fast mode. Omitting the flag preserves the scenario setting; explicit true enables it. Apply the same rule to simulate, ltv, compare, eta, and evaluate, and derive execution hashes and default seeds from the effective mode while preserving evaluate's stage scopes.
