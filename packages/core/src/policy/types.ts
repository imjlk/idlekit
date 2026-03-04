import type { MoneyState } from "../money/types";

export type TickPolicy = Readonly<{
  mode: "drop" | "accumulate";
  maxLogGap?: number;
}>;

export type CoreOptions = Readonly<{
  collectEvents?: boolean;
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

export type TickResult<N, U extends string> = Readonly<{
  status: TickStatus;
  state: MoneyState<N, U>;
  events: readonly MoneyEvent<N>[];
}>;
