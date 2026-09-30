---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Pin development toolchain dependencies for the ttsc compatibility baseline.

- pin `@idlekit/core` `typia` to `14.0.6`, the release that matches `@ttsc/graph@0.30.4`
- pin CLI `react` to `19.2.8`, `@types/react` to `19.2.17`, and both `@opentui/react` and `@opentui/core` to `0.4.5`, with a root override so Bunli cannot load a second OpenTUI copy
- simulation results and CLI flags are unchanged
