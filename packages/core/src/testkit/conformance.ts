/**
 * Evidence host for the conformance harness. Types and runners live in
 * `conformanceRun.ts`. This file keeps the generator version and the declared
 * flat-bulk relation. Runners stay out so this file does not export their types.
 */
import { createNumberEngine } from "../engine/breakInfinity";
import { stepOnce } from "../sim/step";
import type { Action, Model, SimState } from "../sim/types";

type FlatUnit = "COIN";
type FlatVars = { buys: number };

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Records generator version 1. Test seeds and game seeds stay on separate streams, and one intentional gap predicate shrinks to its minimal failing integer.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: version 1 is this constant, shrink-gap keeps values outside 1..7, and relation checks refuse off-grid resume, undeclared bulk equality, and debt bans the model does not claim.
 */
export const conformanceGeneratorVersion = 1;

function flatBulkSnapshot(size: number, mode: "bulk" | "repeated"): string {
  const engine = createNumberEngine();
  const unit = { code: "COIN" as const };
  const action: Action<number, FlatUnit, FlatVars> = {
    id: "flat",
    kind: "buy",
    canApply: () => true,
    cost: () => ({ unit, amount: 10 }),
    bulk: () => [{ size, cost: { unit, amount: 10 * size } }],
    apply: (_ctx, current, bulkSize = 1) => ({
      ...current,
      vars: { buys: current.vars.buys + bulkSize },
    }),
  };
  const model: Model<number, FlatUnit, FlatVars> = {
    id: "flat-bulk",
    version: 1,
    income: () => ({ unit, amount: 0 }),
    actions: () => [action],
  };
  let current: SimState<number, FlatUnit, FlatVars> = {
    t: 0,
    wallet: { money: { unit, amount: 10_000 }, bucket: engine.zero() },
    maxMoneyEver: { unit, amount: 10_000 },
    prestige: { count: 0, points: engine.zero(), multiplier: engine.from(1) },
    vars: { buys: 0 },
  };
  const ctx = { E: engine, unit, tickPolicy: { mode: "drop" as const } };
  if (mode === "bulk") {
    current = stepOnce({
      ctx,
      model,
      state: current,
      dt: 0,
      decisions: [{ action, bulkSize: size }],
    }).next;
  } else {
    for (let index = 0; index < size; index += 1) {
      current = stepOnce({ ctx, model, state: current, dt: 0, decisions: [{ action }] }).next;
    }
  }
  return JSON.stringify({
    wallet: engine.toString(current.wallet.money.amount),
    buys: current.vars.buys,
  });
}

/**
 * Declared equality of one quoted flat bulk buy and the same number of single buys.
 *
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness bulk(n) matches repeated single buys only when the fixture declares that equivalence.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: this relation is the declared flat case, and an undeclared mismatch stays out of it.
 */
export function declaredFlatBulkMatches(size: number): boolean {
  return flatBulkSnapshot(size, "repeated") === flatBulkSnapshot(size, "bulk");
}
