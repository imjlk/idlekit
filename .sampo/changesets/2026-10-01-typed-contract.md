---
npm/@idlekit/core: patch
---

Generate the ScenarioV1 structural schema from the TypeScript type.

- `typia.json.schema` OpenAPI 3.1 is the checked artifact
- `contracts:check` compares bytes and does not rewrite tracked schemas
- `validateScenarioV1` stays the semantic runtime gate
- unknown keys stay allowed at runtime even though the schema text sets `additionalProperties` to false
- analysis DTOs can append to `contractRegistry` later; existing DTOs are not migrated here
