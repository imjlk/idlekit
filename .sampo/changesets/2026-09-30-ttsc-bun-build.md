---
npm/@idlekit/core: minor
npm/@idlekit/cli: patch
---

Route package check and money/core emit through ttsc, and stop treating an unresolved typia generic as a user-input error.

- `typiaStandardSchema()` now throws `TypiaTransformMissingError`. That breaks callers who caught a failed Standard Schema result, so core is a minor bump while the package is still `0.x`: `^0.1.0` does not take `0.2.0`. A v1 major stays off until the release-process migration gates are ready. Callers that still want a failed result use `standardSchemaFromValidate()`.
- add `standardSchemaFromValidate()`, `ConcreteQuota`, `validateConcreteQuota`, and `concreteQuotaSchema`
- `@idlekit/cli` depends on `@opentui/core` `0.4.5` so the bundled CLI resolves the same OpenTUI copy as `@opentui/react`
- CLI flags and the `#!/usr/bin/env bun` shebang are unchanged
