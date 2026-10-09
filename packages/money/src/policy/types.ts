import type { MoneyState } from "../money/types";

export type TickPolicy = Readonly<{
  mode: "drop" | "accumulate";
  maxLogGap?: number;
}>;

export type CoreOptions = Readonly<{
  collectEvents?: boolean;
  /** Compact event counts and reward amounts, independent of event retention. */
  collectFacts?: boolean;
}>;

export type MoneyEvent<N> =
  | {
      type: "blocked";
      reason: "unitMismatch";
      baseUnit: string;
      deltaUnit: string;
    }
  | {
      type: "applied";
      baseBefore: N;
      baseAfter: N;
      delta: N;
      logGap?: number;
    }
  | {
      type: "dropped";
      base: N;
      delta: N;
      logGap: number;
      reason: "tooSmall";
    }
  | {
      type: "queued";
      base: N;
      delta: N;
      bucketAfter: N;
      logGap: number;
      reason: "tooSmall";
    }
  | {
      type: "flushed";
      baseBefore: N;
      baseAfter: N;
      bucketFlushed: N;
      reason: "becameSignificant";
    };

export type TickStatus = "ok" | "blocked";

export type TickFactCounts = Readonly<{
  applied: number;
  dropped: number;
  queued: number;
  flushed: number;
  blocked: number;
}>;

export type TickResult<N, U extends string> = Readonly<{
  status: TickStatus;
  state: MoneyState<N, U>;
  events: readonly MoneyEvent<N>[];
  /** Present only when collectFacts is requested. Counts match the full event stream. */
  facts?: TickFactCounts;
  /** The applied event's delta, including queued money in accumulate mode. */
  appliedDelta?: N;
  /** The flushed event's prior bucket, when that event occurs. */
  flushedBucket?: N;
}>;
