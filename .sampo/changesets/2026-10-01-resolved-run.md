---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Keep evaluate stages on one resolved run plan.

- one compile feeds a fresh simulate, experience, and ltv instance
- `--strategy` accepts a registered id and reaches all three stages
- `--step` and `--fast` stay on simulate and ltv unless `--consistent-overrides` is set
- the default engine remains `number`; `scenario.engine` is metadata
- `breakInfinity` can be selected explicitly; `breakEternity` stays unsupported
- amount goals use `parseMoney` on the amount path
- strategy params stay legacy-raw unless validated mode is requested
- `scenarioHash` stays the original scenario; `effectiveRunHash` omits time and absolute paths
- `idlekit.resolved-run-configuration` is not registered with a contract generator; that waits until TC-05
