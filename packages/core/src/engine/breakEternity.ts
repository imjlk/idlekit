/**
 * Compatibility re-export from `@idlekit/money`; the implementation lives there.
 * `@idlekit/money` is the canonical import path for money primitives. New code
 * that only needs money primitives should import from `@idlekit/money` directly.
 * These re-exports are kept for the v1 compatibility contract and are scheduled
 * for deprecation; they will not be removed within v1.
 *
 * `breakEternityEngine` is NOT implemented: every method throws
 * `BREAK_ETERNITY_EXPERIMENTAL_MESSAGE`. It is exported only to keep the public
 * surface stable. Use `breakInfinityEngine` or a custom `Engine` adapter.
 */
export {
  BREAK_ETERNITY_EXPERIMENTAL_MESSAGE,
  breakEternityEngine,
  createBreakEternityEngine,
} from "@idlekit/money";
