/**
 * Evidence host for the conformance harness. Relation functions are
 * re-exported from `conformanceRun.ts`. Types stay in that file, so this
 * module does not export their properties. The declared flat-bulk relation
 * lives here. Do not export this module from a package barrel.
 */
import { createNumberEngine } from "../engine/breakInfinity";
import { stepOnce } from "../sim/step";
import type { Action, CompiledScenario, Model, SimState } from "../sim/types";
import { checkResumeFromJson } from "./conformanceRun";
import type { RelationCheck } from "./conformanceRun";

type FlatUnit = "COIN";
type FlatVars = { buys: number };

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Records generator version 1. Test seeds and game seeds stay on separate streams, and one intentional gap predicate shrinks to its minimal failing integer.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #f518b31 Re-read the section: version 1 is this constant, shrink-gap keeps values outside 1..7, and relation checks refuse off-grid resume, undeclared bulk equality, and debt bans the model does not claim.
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
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #f518b31 Re-read the section: this relation is the declared flat case, and an undeclared mismatch stays out of it.
 */
export function declaredFlatBulkMatches(size: number): boolean {
  return flatBulkSnapshot(size, "repeated") === flatBulkSnapshot(size, "bulk");
}

/**
 * A declared cooldown fixture preserves its reset timing across an on-grid JSON checkpoint.
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Checks the declared positive-cooldown relation; missing cooldowns and undeclared fixtures do not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #f518b31 Re-read the cooldown clause and ran the short and 200-case corpus: JSON resumes preserve the anchor and reset timing. The undeclared and disabled cases remain inapplicable.
 */
export function checkCooldownResumeFromJson<N, U extends string, Vars>(
  declared: boolean,
  scenario: CompiledScenario<N, U, Vars>,
  splitSec: number,
): RelationCheck {
  const interval = scenario.constraints?.minPrestigeIntervalSec;
  if (!declared || interval === undefined || !Number.isFinite(interval) || interval <= 0) {
    return { ok: true, applicable: false, summary: "positive prestige cooldown equivalence is not declared" };
  }
  return checkResumeFromJson(scenario, splitSec);
}

export {
  checkBulk,
  checkDurationBoundary,
  checkJsonRoundTrip,
  checkNonNegative,
  checkObserver,
  checkReplay,
  checkResume,
  checkResumeFromJson,
  checkRetention,
  checkSnapshots,
  checkTimedSources,
  checkTrialOrder,
  conformanceCaseCount,
  demonstrateShrinkGap,
  economyAfter,
  expectProperty,
  gameSeedForCase,
  rejectNonPositiveStep,
  replayShrinkReport,
  snapshotEconomy,
} from "./conformanceRun";
