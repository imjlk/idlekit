import type { Engine } from "../engine/types";
import type { MoneyState, Unit } from "../money/types";

export type MoneyStateJSON = Readonly<{
  v: 1;
  unit: string;
  amount: string;
  bucket: string;
  engine?: Readonly<{ name: string; version?: string }>;
}>;

export function serializeMoneyState<N, U extends string>(
  E: Engine<N>,
  state: MoneyState<N, U>,
  meta?: { engineName?: string; engineVersion?: string },
): MoneyStateJSON {
  return {
    v: 1,
    unit: state.money.unit.code,
    amount: E.toString(state.money.amount),
    bucket: E.toString(state.bucket),
    engine: meta?.engineName
      ? {
          name: meta.engineName,
          version: meta.engineVersion,
        }
      : undefined,
  };
}

export function deserializeMoneyState<N, U extends string>(
  E: Engine<N>,
  json: MoneyStateJSON,
  opts?: {
    unitFactory?: (code: string) => Unit<U>;
    allowFutureVersions?: boolean;
  },
): MoneyState<N, U> {
  if (typeof json !== "object" || json === null) {
    throw new TypeError("Money state must be an object");
  }
  if (json.v !== 1 && !opts?.allowFutureVersions) {
    throw new Error(`Unsupported money state version: ${json.v}`);
  }
  // Saved state is often read back from JSON on disk, so the types are not guaranteed.
  for (const key of ["unit", "amount", "bucket"] as const) {
    if (typeof json[key] !== "string") {
      throw new TypeError(`Money state field "${key}" must be a string (received: ${typeof json[key]})`);
    }
  }

  const unit = opts?.unitFactory
    ? opts.unitFactory(json.unit)
    : ({ code: json.unit as U } satisfies Unit<U>);

  return {
    money: {
      unit,
      amount: E.from(json.amount),
    },
    bucket: E.from(json.bucket),
  };
}
