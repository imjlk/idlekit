import type { Engine } from "./types";

export const BREAK_ETERNITY_EXPERIMENTAL_MESSAGE =
  "breakEternityEngine is experimental and not implemented in idlekit v1. Use breakInfinityEngine or provide a custom Engine adapter.";

function notImplemented(): never {
  throw new Error(BREAK_ETERNITY_EXPERIMENTAL_MESSAGE);
}

/**
 * Placeholder, NOT implemented in idlekit v1: every method throws
 * {@link BREAK_ETERNITY_EXPERIMENTAL_MESSAGE}. Exported only to keep the public
 * surface stable. Use `createBreakInfinityEngine` or a custom `Engine` adapter.
 */
export function createBreakEternityEngine(): Engine<never> {
  return {
    zero: notImplemented,
    from: notImplemented,
    add: notImplemented,
    sub: notImplemented,
    mul: notImplemented,
    div: notImplemented,
    mulN: notImplemented,
    divN: notImplemented,
    cmp: notImplemented,
    absLog10: notImplemented,
    isFinite: notImplemented,
    toString: notImplemented,
    toNumber: notImplemented,
  };
}

/** Placeholder, NOT implemented in idlekit v1. See {@link createBreakEternityEngine}. */
export const breakEternityEngine = createBreakEternityEngine();
