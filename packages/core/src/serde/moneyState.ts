/**
 * Compatibility re-export from `@idlekit/money`; the implementation lives there.
 * `@idlekit/money` is the canonical import path for money primitives. New code
 * that only needs money primitives should import from `@idlekit/money` directly.
 * These re-exports are kept for the v1 compatibility contract and are scheduled
 * for deprecation; they will not be removed within v1.
 */
export { deserializeMoneyState, serializeMoneyState, type MoneyStateJSON } from "@idlekit/money";
