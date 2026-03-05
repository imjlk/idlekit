import type { Engine } from "../engine/types";
import type { Money, MoneyState, Unit } from "../money/types";
import type { Emitter } from "../policy/emitter";
import type { MoneyEvent, TickPolicy } from "../policy/types";

export type SimState<N, U extends string, Vars> = Readonly<{
  t: number;
  wallet: MoneyState<N, U>;
  maxMoneyEver: Money<N, U>;

  prestige: Readonly<{
    count: number;
    points: N;
    multiplier: N;
  }>;

  vars: Vars;
}>;

export type SimEvent<N> =
  | {
      type: "money";
      events: readonly MoneyEvent<N>[];
    }
  | {
      type: "action.applied";
      actionId: string;
      label?: string;
      detail?: unknown;
    }
  | {
      type: "action.skipped";
      actionId: string;
      reason: "cannotApply" | "insufficientFunds";
    }
  | {
      type: "milestone";
      key: string;
      detail?: unknown;
    }
  | {
      type: "warning";
      code: string;
      detail?: unknown;
    };

export type SimContext<N, U extends string, Vars> = Readonly<{
  E: Engine<N>;
  unit: Unit<U>;

  // Optional runtime hint for strategies requiring time-scale aware preview.
  stepSec?: number;
  // Optional deterministic seed for stochastic strategy/model extensions.
  seed?: number;

  tickPolicy: TickPolicy;
  collectMoneyEvents?: boolean;

  payment?: Readonly<{
    onInsufficientFunds?: "skip" | "warn" | "throw";
  }>;

  emit?: Emitter<SimEvent<N>>;
}>;

export type BulkQuote<N, U extends string> = Readonly<{
  size: number;
  cost: Money<N, U> | null;
  equivalentCost?: Money<N, U>;
  deltaIncomePerSec?: Money<N, U>;
}>;

export type Action<N, U extends string, Vars> = Readonly<{
  id: string;
  kind: "buy" | "prestige" | "grant" | "custom";
  label?: string;

  canApply: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => boolean;

  cost: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => Money<N, U> | null;

  equivalentCost?: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => Money<N, U>;

  bulk?: (
    ctx: SimContext<N, U, Vars>,
    state: SimState<N, U, Vars>,
  ) => readonly BulkQuote<N, U>[];

  apply: (
    ctx: SimContext<N, U, Vars>,
    state: SimState<N, U, Vars>,
    bulkSize?: number,
  ) => SimState<N, U, Vars>;
}>;

export type AnalyticHints<N, U extends string, Vars> = Readonly<{
  incomeKind?: "constant" | "linear" | "custom";

  generator?: Readonly<{
    ownedVarPath: string;
    incomePerOwned: Money<N, U>;
    baseIncome?: Money<N, U>;
  }>;

  costExp?: Readonly<{
    ownedVarPath: string;
    a: Money<N, U>;
    b: number;
  }>;

  softcap?: Readonly<{
    kind: "log" | "sqrt" | "pow";
    startsAt: Money<N, U>;
    strength?: number;
  }>;

  _vars?: Vars;
}>;

export type PrestigeSpec<N, U extends string, Vars> = Readonly<{
  pointsFrom: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => N;
  multiplierFrom: (ctx: SimContext<N, U, Vars>, points: N) => N;

  resetState: (
    ctx: SimContext<N, U, Vars>,
    state: SimState<N, U, Vars>,
    gainedPoints: N,
  ) => SimState<N, U, Vars>;
}>;

export interface Model<N, U extends string, Vars> {
  id: string;
  version: number;

  income: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => Money<N, U>;

  evolve?: (
    ctx: SimContext<N, U, Vars>,
    state: SimState<N, U, Vars>,
    dt: number,
  ) => SimState<N, U, Vars>;

  actions: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => readonly Action<N, U, Vars>[];

  prestige?: PrestigeSpec<N, U, Vars>;

  netWorth?: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => Money<N, U>;

  analytic?: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => AnalyticHints<N, U, Vars> | null;

  milestones?: (
    ctx: SimContext<N, U, Vars>,
    prev: SimState<N, U, Vars>,
    next: SimState<N, U, Vars>,
  ) => string[];
}

export type ScenarioConstraints = Readonly<{
  maxActionsPerStep?: number;
  minPrestigeIntervalSec?: number;
}>;

export type SimRunOptions = Readonly<{
  stepSec: number;
  durationSec?: number;
  until?: (s: any) => boolean;
  // Hard guard against accidental unbounded runs.
  maxSteps?: number;

  offline?: Readonly<{
    maxSec?: number;
    overflowPolicy?: "clamp" | "reject";
    decay?: Readonly<{
      kind: "none" | "linear";
      // Only used when kind=linear. 0..1
      floorRatio?: number;
    }>;
  }>;

  // Event retention policy for long-running simulations.
  eventLog?: Readonly<{
    // false => do not retain events in RunResult.events (stats are still computed).
    enabled?: boolean;
    // Keep only the latest N events (ring-buffer style). Undefined => unbounded.
    maxEvents?: number;
  }>;

  trace?: Readonly<{
    everySteps?: number;
    keepActionsLog?: boolean;
  }>;

  fast?: Readonly<{
    enabled: boolean;
    kind?: "log-domain";
    disableMoneyEvents?: boolean;
  }>;
}>;

export type CompiledScenario<N, U extends string, Vars> = Readonly<{
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  initial: SimState<N, U, Vars>;
  constraints?: ScenarioConstraints;
  run: SimRunOptions;
  strategy?: import("./strategy/types").Strategy<N, U, Vars>;
}>;

export type RunResult<N, U extends string, Vars> = Readonly<{
  start: SimState<N, U, Vars>;
  end: SimState<N, U, Vars>;

  events: readonly SimEvent<N>[];

  trace?: readonly SimState<N, U, Vars>[];
  actionsLog?: readonly {
    t: number;
    actionId: string;
    label?: string;
    bulkSize?: number;
  }[];

  stats?: import("./analysis/ux").SimStats;
  uxFlags?: import("./analysis/ux").UXFlag[];
  eventLog?: Readonly<{
    enabled: boolean;
    maxEvents?: number;
    totalSeen: number;
    dropped: number;
    retained: number;
  }>;
}>;
