import type { Engine } from "../engine/types";
import type { Unit } from "../money/types";
import type { SimState } from "../sim/types";

export type SimStateJSON = Readonly<{
  v: 1;
  unit: string;
  t: number;
  wallet: Readonly<{
    amount: string;
    bucket: string;
  }>;
  maxMoneyEver: string;
  prestige: Readonly<{
    count: number;
    points: string;
    multiplier: string;
  }>;
  vars: unknown;
  engine?: Readonly<{ name: string; version?: string }>;
  meta?: Readonly<{ scenarioPath?: string; savedAt?: string }>;
}>;

export function serializeSimState<N, U extends string, Vars>(
  E: Engine<N>,
  state: SimState<N, U, Vars>,
  meta?: {
    engineName?: string;
    engineVersion?: string;
    scenarioPath?: string;
    savedAt?: string;
  },
): SimStateJSON {
  return {
    v: 1,
    unit: state.wallet.money.unit.code,
    t: state.t,
    wallet: {
      amount: E.toString(state.wallet.money.amount),
      bucket: E.toString(state.wallet.bucket),
    },
    maxMoneyEver: E.toString(state.maxMoneyEver.amount),
    prestige: {
      count: state.prestige.count,
      points: E.toString(state.prestige.points),
      multiplier: E.toString(state.prestige.multiplier),
    },
    vars: state.vars,
    engine: meta?.engineName
      ? {
          name: meta.engineName,
          version: meta.engineVersion,
        }
      : undefined,
    meta: meta?.scenarioPath || meta?.savedAt
      ? {
          scenarioPath: meta.scenarioPath,
          savedAt: meta.savedAt,
        }
      : undefined,
  };
}

export function deserializeSimState<N, U extends string, Vars>(
  E: Engine<N>,
  json: SimStateJSON,
  opts?: {
    unitFactory?: (code: string) => Unit<U>;
    expectedUnit?: string;
    allowFutureVersions?: boolean;
  },
): SimState<N, U, Vars> {
  if (json.v !== 1 && !opts?.allowFutureVersions) {
    throw new Error(`Unsupported sim state version: ${json.v}`);
  }

  if (opts?.expectedUnit && json.unit !== opts.expectedUnit) {
    throw new Error(`Sim state unit mismatch: expected ${opts.expectedUnit}, got ${json.unit}`);
  }

  const unit = opts?.unitFactory ? opts.unitFactory(json.unit) : ({ code: json.unit as U } as Unit<U>);

  return {
    t: json.t,
    wallet: {
      money: {
        unit,
        amount: E.from(json.wallet.amount),
      },
      bucket: E.from(json.wallet.bucket),
    },
    maxMoneyEver: {
      unit,
      amount: E.from(json.maxMoneyEver),
    },
    prestige: {
      count: json.prestige.count,
      points: E.from(json.prestige.points),
      multiplier: E.from(json.prestige.multiplier),
    },
    vars: json.vars as Vars,
  };
}
