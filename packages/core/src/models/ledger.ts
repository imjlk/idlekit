import type { Engine } from "../engine/types";
import type { SimState } from "../sim/types";
import { amountOf, finiteAmount, stockOf } from "./shared";

/*
 * Secondary balances kept in `state.vars[field]` as decimal strings. The primary currency is the wallet.
 * Not exported from the package barrel.
 */

export const PRIMARY = "primary" as const;

export type LedgerEntry = Readonly<{
  id: string;
  initial: string;
  cap?: string;
  valueInPrimary: number;
}>;

export type Ledger = Readonly<{
  modelId: string;
  field: string;
  entries: ReadonlyMap<string, LedgerEntry>;
  /** Amount held. `primary` reads the wallet. A missing balance is the entry's initial amount. */
  read: <N, U extends string, Vars>(E: Engine<N>, state: SimState<N, U, Vars>, key: string) => N;
  /** Write one balance. `primary` writes the wallet. A capped entry is clamped and the excess returned. */
  write: <N, U extends string, Vars>(
    E: Engine<N>,
    state: SimState<N, U, Vars>,
    key: string,
    amount: N,
  ) => Readonly<{ state: SimState<N, U, Vars>; overflow: N }>;
  cap: <N>(E: Engine<N>, key: string) => N | undefined;
  /** Primary-equivalent value of the secondary balances. */
  value: <N, U extends string, Vars>(E: Engine<N>, state: SimState<N, U, Vars>) => N;
  valueOf: (key: string) => number;
}>;

export function createLedger(modelId: string, field: string, entries: readonly LedgerEntry[]): Ledger {
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  const bag = (state: Readonly<{ vars?: unknown }>): Record<string, unknown> => {
    const vars = (state.vars ?? {}) as Record<string, unknown>;
    const raw = vars[field];
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  };
  const cap = <N>(E: Engine<N>, key: string): N | undefined => {
    const entry = map.get(key);
    return entry?.cap !== undefined ? amountOf(E, entry.cap, modelId, `${key} cap`) : undefined;
  };
  const read = <N, U extends string, Vars>(E: Engine<N>, state: SimState<N, U, Vars>, key: string): N => {
    if (key === PRIMARY) return state.wallet.money.amount;
    const raw = bag(state)[key];
    if (raw === undefined) {
      const entry = map.get(key);
      return entry ? amountOf(E, entry.initial, modelId, `${key} initial`) : E.zero();
    }
    return stockOf(E, raw);
  };
  const write = <N, U extends string, Vars>(
    E: Engine<N>,
    state: SimState<N, U, Vars>,
    key: string,
    amount: N,
  ): Readonly<{ state: SimState<N, U, Vars>; overflow: N }> => {
    let next = finiteAmount(E, amount, modelId, `${key} balance`);
    let overflow = E.zero();
    if (E.cmp(next, E.zero()) < 0) next = E.zero();
    const limit = key === PRIMARY ? undefined : cap(E, key);
    if (limit !== undefined && E.cmp(next, limit) > 0) {
      overflow = E.sub(next, limit);
      next = limit;
    }
    if (key === PRIMARY) {
      return {
        state: { ...state, wallet: { ...state.wallet, money: { ...state.wallet.money, amount: next } } },
        overflow,
      };
    }
    const vars = (state.vars ?? {}) as Record<string, unknown>;
    return {
      state: { ...state, vars: { ...vars, [field]: { ...bag(state), [key]: E.toString(next) } } as Vars },
      overflow,
    };
  };
  const valueOf = (key: string): number => (key === PRIMARY ? 1 : (map.get(key)?.valueInPrimary ?? 0));
  const value = <N, U extends string, Vars>(E: Engine<N>, state: SimState<N, U, Vars>): N => {
    let total = E.zero();
    for (const entry of entries) {
      if (entry.valueInPrimary === 0) continue;
      total = E.add(total, E.mul(read(E, state, entry.id), entry.valueInPrimary));
    }
    return total;
  };
  return { modelId, field, entries: map, read, write, cap, value, valueOf };
}
