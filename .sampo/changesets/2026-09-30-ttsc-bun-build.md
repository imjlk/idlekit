---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Route package check and money/core emit through ttsc, and stop treating an unresolved typia generic as a user-input error.

- `typiaStandardSchema()` now throws `TypiaTransformMissingError`
- add `standardSchemaFromValidate()`, `ConcreteQuota`, `validateConcreteQuota`, and `concreteQuotaSchema`
- `@idlekit/cli` depends on `@opentui/core` `0.4.5` so the bundled CLI resolves the same OpenTUI copy as `@opentui/react`
- CLI flags and the `#!/usr/bin/env bun` shebang are unchanged
