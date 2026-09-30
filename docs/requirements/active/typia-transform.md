# Typia transform

## Unresolved generic is not a user-input error {#req-typia-transform-missing}

Requirement `REQ-TC02-TYPIA-TRANSFORM-MISSING`. `TC-02` implemented it. `TC-03` places it in the active evidence population.

`typiaStandardSchema<T>()` throws `TypiaTransformMissingError` when `T` is not a concrete type argument. That failure is a missing transform, not a rejected user value.

A concrete site calls `typia.createValidate<ConcreteQuota>()` and passes the function to `standardSchemaFromValidate()`. `validateConcreteQuota` accepts `{ count: 2 }` and rejects `{ count: "no" }`. `concreteQuotaSchema` adapts that same function.

The `TC-01` toolchain evidence fixture remains on the inventory baseline at `fixtures/toolchain/evidence`. It is not another heading in this file. This section is the product contract.
