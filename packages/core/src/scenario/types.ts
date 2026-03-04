export type NumStr = string;

export type ScenarioV1 = Readonly<{
  schemaVersion: 1;

  meta?: Readonly<{
    id?: string;
    title?: string;
    description?: string;
    tags?: string[];
  }>;

  engine?: Readonly<{
    name: string;
    version?: string;
  }>;

  unit: Readonly<{
    code: string;
    symbol?: string;
  }>;

  policy: Readonly<{
    mode: "drop" | "accumulate";
    maxLogGap?: number;
  }>;

  model: Readonly<{
    id: string;
    version: number;
    params?: unknown;
  }>;

  initial: Readonly<{
    t?: number;
    wallet: Readonly<{
      unit: string;
      amount: NumStr;
      bucket?: NumStr;
    }>;
    maxMoneyEver?: NumStr;
    prestige?: Readonly<{
      count?: number;
      points?: NumStr;
      multiplier?: NumStr;
    }>;
    vars?: unknown;
  }>;

  clock: Readonly<{
    stepSec: number;
    durationSec?: number;
    untilExpr?: string;
  }>;

  strategy?: Readonly<{
    id: string;
    params?: unknown;
  }>;

  constraints?: Readonly<{
    maxActionsPerStep?: number;
    minPrestigeIntervalSec?: number;
  }>;

  analysis?: Readonly<{
    eta?: Readonly<{ mode?: "simulate" | "analytic" }>;
    prestigeCycle?: Readonly<{
      scan?: string;
      stepSec?: number;
      cycles?: number;
    }>;
    growth?: Readonly<{ windowSec?: number }>;
  }>;

  sim?: Readonly<{
    fast?: boolean;
  }>;

  outputs?: Readonly<{
    format?: "json" | "md" | "csv";
    outPath?: string;
    report?: Readonly<{
      checkpointsSec?: number[];
      includeTrace?: boolean;
      traceEverySteps?: number;
      includeGrowth?: boolean;
      includeUX?: boolean;
    }>;
    assertions?: ReadonlyArray<{
      expr: string;
      severity?: "error" | "warn";
    }>;
  }>;
}>;
