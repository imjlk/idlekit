import type { Engine } from "../engine/types";
import type { Unit } from "../money/types";
import type { SimState } from "../sim/types";
import { z } from "zod";

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
  meta?: Readonly<{
    scenarioPath?: string;
    savedAt?: string;
    runId?: string;
    seed?: number;
    cliVersion?: string;
    gitSha?: string;
    scenarioHash?: string;
  }>;
  strategy?: Readonly<{
    id: string;
    state?: unknown;
  }>;
}>;

const SimStateJSONSchema = z
  .object({
    v: z.number(),
    unit: z.string().min(1),
    t: z.number().finite(),
    wallet: z.object({
      amount: z.string(),
      bucket: z.string(),
    }),
    maxMoneyEver: z.string(),
    prestige: z.object({
      count: z.number().int(),
      points: z.string(),
      multiplier: z.string(),
    }),
    vars: z.unknown(),
    engine: z
      .object({
        name: z.string(),
        version: z.string().optional(),
      })
      .optional(),
    meta: z
      .object({
        scenarioPath: z.string().optional(),
        savedAt: z.string().optional(),
        runId: z.string().optional(),
        seed: z.number().finite().optional(),
        cliVersion: z.string().optional(),
        gitSha: z.string().optional(),
        scenarioHash: z.string().optional(),
      })
      .passthrough()
      .optional(),
    strategy: z
      .object({
        id: z.string().min(1),
        state: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function parseSimStateJSON(input: unknown): SimStateJSON {
  const r = SimStateJSONSchema.safeParse(input);
  if (r.success) {
    return r.data as SimStateJSON;
  }
  const detail = r.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(`Invalid sim state json: ${detail}`);
}

export function serializeSimState<N, U extends string, Vars>(
  E: Engine<N>,
  state: SimState<N, U, Vars>,
  meta?: {
    engineName?: string;
    engineVersion?: string;
    scenarioPath?: string;
    savedAt?: string;
    runId?: string;
    seed?: number;
    cliVersion?: string;
    gitSha?: string;
    scenarioHash?: string;
    strategy?: {
      id: string;
      state?: unknown;
    };
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
    meta:
      meta?.scenarioPath ||
      meta?.savedAt ||
      meta?.runId ||
      meta?.seed !== undefined ||
      meta?.cliVersion ||
      meta?.gitSha ||
      meta?.scenarioHash
      ? {
          scenarioPath: meta.scenarioPath,
          savedAt: meta.savedAt,
          runId: meta.runId,
          seed: meta.seed,
          cliVersion: meta.cliVersion,
          gitSha: meta.gitSha,
          scenarioHash: meta.scenarioHash,
        }
      : undefined,
    strategy: meta?.strategy
      ? {
          id: meta.strategy.id,
          state: meta.strategy.state,
        }
      : undefined,
  };
}

export function deserializeSimState<N, U extends string, Vars>(
  E: Engine<N>,
  json: unknown,
  opts?: {
    unitFactory?: (code: string) => Unit<U>;
    expectedUnit?: string;
    allowFutureVersions?: boolean;
  },
): SimState<N, U, Vars> {
  const parsed = parseSimStateJSON(json);

  if (parsed.v !== 1 && !opts?.allowFutureVersions) {
    throw new Error(`Unsupported sim state version: ${parsed.v}`);
  }

  if (opts?.expectedUnit && parsed.unit !== opts.expectedUnit) {
    throw new Error(`Sim state unit mismatch: expected ${opts.expectedUnit}, got ${parsed.unit}`);
  }

  const unit = opts?.unitFactory ? opts.unitFactory(parsed.unit) : ({ code: parsed.unit as U } as Unit<U>);

  return {
    t: parsed.t,
    wallet: {
      money: {
        unit,
        amount: E.from(parsed.wallet.amount),
      },
      bucket: E.from(parsed.wallet.bucket),
    },
    maxMoneyEver: {
      unit,
      amount: E.from(parsed.maxMoneyEver),
    },
    prestige: {
      count: parsed.prestige.count,
      points: E.from(parsed.prestige.points),
      multiplier: E.from(parsed.prestige.multiplier),
    },
    vars: parsed.vars as Vars,
  };
}
