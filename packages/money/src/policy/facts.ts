import type { TickFactCounts } from "./types";

// Counts have no amounts or run identity and can be shared without per-tick allocation.
export const APPLIED_FACTS: TickFactCounts = Object.freeze({ applied: 1, dropped: 0, queued: 0, flushed: 0, blocked: 0 });
export const DROPPED_FACTS: TickFactCounts = Object.freeze({ applied: 0, dropped: 1, queued: 0, flushed: 0, blocked: 0 });
export const QUEUED_FACTS: TickFactCounts = Object.freeze({ applied: 0, dropped: 0, queued: 1, flushed: 0, blocked: 0 });
export const FLUSHED_FACTS: TickFactCounts = Object.freeze({ applied: 1, dropped: 0, queued: 0, flushed: 1, blocked: 0 });
export const BLOCKED_FACTS: TickFactCounts = Object.freeze({ applied: 0, dropped: 0, queued: 0, flushed: 0, blocked: 1 });
