---
npm/@idlekit/core: minor
npm/@idlekit/cli: minor
---

Register growth and ETA analyzers without a second numeric engine.

- `idk analyze <id>` runs a registered analyzer and keeps `idk eta`, `idk growth`, and `idk prestige-cycle`
- a short observation returns insufficient-data instead of a silent long run
- plugin analyzers still require the existing allow, root, and sha256 checks
