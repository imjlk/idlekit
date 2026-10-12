/**
 * Evidence host for the conformance harness. Relation functions are
 * re-exported from `conformanceRun.ts`. Types stay in that file, so this
 * module does not export their properties. The declared flat-bulk relation
 * lives here. Do not export this module from a package barrel.
 */
import { createNumberEngine } from "../engine/breakInfinity";
import { createModelRegistry, defineModelFactory } from "../scenario/registry";
import { canonicalJson, sha256Text } from "../scenario/scenarioContract";
import type { ScenarioV1 } from "../scenario/types";
import { runExperiment } from "../sim/analysis/experiment";
import type { MilestoneReport } from "../sim/analysis/milestones";
import { createStrategyRegistry } from "../sim/strategy/registry";
import { stepOnce } from "../sim/step";
import type { Action, CompiledScenario, Model, SimState } from "../sim/types";
import { checkResumeFromJson, checkSnapshots } from "./conformanceRun";
import type { RelationCheck } from "./conformanceRun";

type FlatUnit = "COIN";
type FlatVars = { buys: number };

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Records generator version 1. Test seeds and game seeds stay on separate streams, and one intentional gap predicate shrinks to its minimal failing integer.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the section: version 1 is this constant, shrink-gap keeps values outside 1..7, and relation checks refuse off-grid resume, undeclared bulk equality, and debt bans the model does not claim.
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
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the section: this relation is the declared flat case, and an undeclared mismatch stays out of it.
 */
export function declaredFlatBulkMatches(size: number): boolean {
  return flatBulkSnapshot(size, "repeated") === flatBulkSnapshot(size, "bulk");
}

/**
 * A declared cooldown fixture preserves its reset timing across an on-grid JSON checkpoint.
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Checks the declared positive-cooldown relation; missing cooldowns and undeclared fixtures do not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the cooldown clause and ran the short and 200-case corpus: JSON resumes preserve the anchor and reset timing. The undeclared and disabled cases remain inapplicable.
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

/**
 * A declared observation-enabled fixture keeps its first times when samples are capped.
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Checks only the declared milestone retention relation, comparing summaries from executed runs.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Read the declared retention clause and exercised the short and extended corpus, including a zero cap, many actions before prestige, and fixtures without any action. Undeclared fixtures remain inapplicable.
 */
export function checkMilestoneRetention(declared: boolean, full: MilestoneReport, capped: MilestoneReport): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "milestone retention equivalence is not declared" };
  const firsts = (report: MilestoneReport) => JSON.stringify({
    milestone: report.firstMilestoneSec,
    action: report.firstActionSec,
    prestige: report.firstPrestigeSec,
  });
  return checkSnapshots(firsts(full), firsts(capped), "same");
}

/** Inputs of the constant-income experiment relation. Both rates divide the target, so each reach time is on the step-1 grid. */
type ConstantIncomeExperimentCase = Readonly<{
  target: number;
  baselineRate: number;
  probeRate: number;
  seed: number;
}>;

/**
 * A declared constant-income experiment reaches money `T` at `T/p` and its local reach-time elasticity is `-p/p'`.
 * The relation runs `runExperiment` on a scenario with rate `p`, one probe `p'`, step `1`, and a horizon past both reach times.
 *
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity Runs the constant-income experiment and compares reach times T/p and T/p' and elasticity -p/p'.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity #bd1aa44 Re-read the section: the conformance relation runs divisor rates through runExperiment and an undeclared case does not apply.
 */
export function checkConstantIncomeExperiment(declared: boolean, value: ConstantIncomeExperimentCase): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "constant-income experiment relation is not declared" };
  const { target, baselineRate, probeRate, seed } = value;
  const model = defineModelFactory({
    id: "conformance-constant-income",
    version: 1,
    create: (params: { incomeRate: number }) => ({
      id: "conformance-constant-income",
      version: 1,
      income: (ctx: { unit: { code: string } }) => ({ unit: ctx.unit, amount: params.incomeRate }),
      actions: () => [],
    }),
  });
  const scenario: ScenarioV1 = {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "conformance-constant-income", version: 1, params: { incomeRate: baselineRate } },
    initial: { wallet: { unit: "COIN", amount: "0" } },
    clock: { stepSec: 1, durationSec: 1 },
  };
  const horizonSec = target / Math.min(baselineRate, probeRate) + 1;
  const artifact = runExperiment({
    spec: {
      schemaVersion: 1,
      scenario: { ref: "conformance:constant-income", hash: sha256Text(canonicalJson(scenario)) },
      model: { id: "conformance-constant-income", version: 1 },
      metricId: "timeToMoney",
      goal: { target },
      dimensions: [
        {
          id: "incomeRate",
          target: "model",
          path: "incomeRate",
          space: { kind: "number", min: 0, max: Math.max(baselineRate, probeRate) },
          baseline: baselineRate,
          probes: [probeRate],
        },
      ],
      budget: { candidates: 2, seeds: 1 },
      seeds: [seed],
      horizonSec,
      stepSec: 1,
      session: { pattern: "always-on", days: 1 },
    },
    scenario,
    modelRegistry: createModelRegistry([model]),
    strategyRegistry: createStrategyRegistry([]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "conformance",
    effectiveRunHash: "conformance:constant-income",
  });
  const reach = (id: string) => artifact.candidates.find((candidate) => candidate.id === id)?.metrics[0]?.value;
  const row = artifact.elasticities.find((entry) => entry.metricId === "timeToMoney");
  const expected = -baselineRate / probeRate;
  const measured = Number(row?.elasticity);
  const reachOk = reach("baseline") === String(target / baselineRate) && reach(`oat:incomeRate:${probeRate}`) === String(target / probeRate);
  const elasticityOk = row?.status === "observed" && Math.abs(measured - expected) <= 1e-12 * Math.abs(expected);
  const directionOk = row?.direction === (probeRate > baselineRate ? "lower" : "higher");
  return {
    ok: reachOk && elasticityOk && directionOk,
    applicable: true,
    summary: `target ${target}, rates ${baselineRate} and ${probeRate}: reach ${reach("baseline")} and ${reach(`oat:incomeRate:${probeRate}`)}, elasticity ${row?.elasticity} against ${expected}`,
  };
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
