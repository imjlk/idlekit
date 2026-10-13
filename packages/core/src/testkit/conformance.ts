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
import { independentBernoulli } from "../sim/analysis/distribution";
import { runExperiment } from "../sim/analysis/experiment";
import type { GrowthFitArtifactV1 } from "../sim/analysis/growthFit";
import type { MilestoneReport } from "../sim/analysis/milestones";
import { executeResetCycles } from "../sim/analysis/resetCycle";
import type { ResetCycleExecution, ResetCyclePolicy } from "../sim/analysis/resetCycle";
import { analyzeResetPolicies } from "../sim/analysis/resetOptimization";
import { applyOfflineSeconds } from "../sim/offline";
import { runScenario } from "../sim/simulator";
import { stepOnce } from "../sim/step";
import { createStrategyRegistry } from "../sim/strategy/registry";
import type { Action, CompiledScenario, Model, SimState } from "../sim/types";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import { checkResumeFromJson, checkSnapshots, snapshotEconomy } from "./conformanceRun";
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
 * A declared seeded drop: one uniform per logical draw, from `independentBernoulli`, keeps the empirical rate of
 * `draws` draws within `absoluteTolerance` of `probability`. The rate is not required to equal the probability.
 *
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The seeded-drop tolerance is a declared relation over logical draw seeds. An undeclared fixture does not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the section: seeded relations are conditional, so this one applies only when declared, and a rate outside the tolerance fails rather than skips.
 */
export function checkSeededDrop(
  declared: boolean,
  fixture: Readonly<{ seed: number; draws: number; probability: number; absoluteTolerance: number }>,
): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "seeded drop tolerance is not declared" };
  if (!Number.isSafeInteger(fixture.draws) || fixture.draws < 1) {
    return { ok: false, applicable: true, summary: "seeded drop draws must be a positive integer" };
  }
  if (!Number.isFinite(fixture.absoluteTolerance) || fixture.absoluteTolerance < 0) {
    return { ok: false, applicable: true, summary: "seeded drop tolerance must be a finite number >= 0" };
  }
  let hits = 0;
  for (let drawIndex = 0; drawIndex < fixture.draws; drawIndex += 1) {
    if (independentBernoulli(fixture.seed, drawIndex, fixture.probability)) hits += 1;
  }
  const rate = hits / fixture.draws;
  const gap = Math.abs(rate - fixture.probability);
  const summary = `rate ${rate} for probability ${fixture.probability}, gap ${gap}, tolerance ${fixture.absoluteTolerance}`;
  return { ok: gap <= fixture.absoluteTolerance, applicable: true, summary };
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

type ResetVars = Record<string, never>;

/**
 * A declared reset-policy rate fixture keeps its known rate when `analyzeResetPolicies` plays it.
 * Income is 1 coin per second and each committed reset grants `rewardPerReset` points. The relation checks the
 * completed cycle count and time, and the committed reward over completed cycle time against the expected rate.
 * Matching it is not a steady-state proof.
 *
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The known reset-policy rate is a declared relation: committed reward over completed cycle time. An undeclared fixture does not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the section: seeded relations are conditional, so this one applies only when declared, and a wrong expected rate fails rather than skips.
 */
export function checkResetPolicyRate(
  declared: boolean,
  fixture: Readonly<{
    id: string;
    rewardPerReset: string;
    intervalSec: number;
    completedCycles: number;
    completedCycleTimeSec: number;
    horizonSec: number;
    expectedRate: string;
    denominator: string;
  }>,
): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "reset policy rate is not declared" };
  const engine = createNumberEngine();
  const unit = { code: "COIN" as const };
  const reward = engine.from(fixture.rewardPerReset);
  const reset: Action<number, "COIN", ResetVars> = {
    id: "reset",
    kind: "prestige",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({
      ...current,
      prestige: { ...current.prestige, count: current.prestige.count + 1, points: current.prestige.points + reward },
    }),
  };
  const model: Model<number, "COIN", ResetVars> = {
    id: "declared-reset-rate",
    version: 1,
    income: () => ({ unit, amount: 1 }),
    actions: () => [reset],
  };
  const artifact = analyzeResetPolicies<number, "COIN", ResetVars>({
    createScenario: () => ({
      ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
      model,
      initial: {
        t: 0,
        wallet: { money: { unit, amount: 0 }, bucket: 0 },
        maxMoneyEver: { unit, amount: 0 },
        prestige: { count: 0, points: 0, multiplier: 1 },
        vars: {},
      },
      run: { stepSec: 1, durationSec: 1 },
    }),
    scan: { fromSec: fixture.intervalSec, toSec: fixture.intervalSec, stepSec: fixture.intervalSec },
    horizonSec: fixture.horizonSec,
    cycleBudget: fixture.completedCycles + 2,
    objective: "cumulative-reset-reward",
    recovery: { metric: "pre-reset-income" },
    stability: { minObservedCycles: 2, windows: [2, 3], absoluteTolerance: "0", relativeTolerance: 0 },
    knownSolution: { fixtureId: fixture.id, expectedRate: fixture.expectedRate },
  });
  const row = artifact.candidates[0];
  const observed = JSON.stringify({
    denominator: row?.rewardRateDenominator,
    cycles: row?.completedCycles,
    cycleTimeSec: (row?.completedCycles ?? 0) * fixture.intervalSec,
    matches: artifact.knownSolution?.matches === true,
  });
  const expected = JSON.stringify({
    denominator: fixture.denominator,
    cycles: fixture.completedCycles,
    cycleTimeSec: fixture.completedCycleTimeSec,
    matches: true,
  });
  return checkSnapshots(observed, expected, "same");
}

/**
 * A declared growth fixture keeps its window shapes when its amounts are rescaled or its samples are thinned within
 * the budget the fit needs.
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Checks the declared growth scale and sampling relations on executed fits; undeclared fixtures do not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Read the declared relation clause and ran the short and extended corpus: rescaled and thinned fits keep each window's shape and status.
 */
export function checkGrowthShapes(declared: boolean, base: GrowthFitArtifactV1, other: GrowthFitArtifactV1): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "growth shape equivalence is not declared" };
  const shapes = (artifact: GrowthFitArtifactV1) =>
    JSON.stringify(artifact.windows.map((window) => ({ shape: window.shape, status: window.status })));
  return checkSnapshots(shapes(base), shapes(other), "same");
}

/**
 * A declared reset-cycle fixture reaches the same economy, reward total, elapsed seconds, and completed cycle rows when
 * the run is split into a checkpoint and a resume, either between cycles or inside one through a step budget.
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Checks the declared reset-cycle resume relation on executed cycles; undeclared fixtures do not apply.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Read the declared relation clause and ran the short and extended corpus: split and continuous executions agree on the economy, the reward total, the elapsed seconds, and every completed row.
 */
export function checkResetCycleResume<N, U extends string, Vars>(
  declared: boolean,
  scenario: CompiledScenario<N, U, Vars>,
  policy: Extract<ResetCyclePolicy, { kind: "fixed-interval" }>,
  split: Readonly<{ cycles: number }> | Readonly<{ budgetSteps: number }>,
): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "reset-cycle resume equivalence is not declared" };
  const { E } = scenario.ctx;
  // Both branches start from the strategy's initial state. The continuous run would otherwise advance it first.
  const strategy = scenario.strategy;
  const restorable = !!(strategy?.snapshotState && strategy.restoreState);
  if ((strategy?.snapshotState || strategy?.restoreState) && !restorable) {
    return { ok: true, applicable: false, summary: "reset-cycle resume needs a strategy whose state can be restored" };
  }
  const opening = restorable ? deepClonePreservingPrototype(strategy?.snapshotState?.()) : undefined;
  const rewind = () => {
    if (restorable) strategy?.restoreState?.call(strategy, deepClonePreservingPrototype(opening));
  };
  const continuous = executeResetCycles({ scenario, policy });
  rewind();
  const first =
    "cycles" in split
      ? executeResetCycles({ scenario, policy: { ...policy, cycles: split.cycles } })
      : executeResetCycles({ scenario, policy, budgetSteps: split.budgetSteps });
  const remaining = policy.cycles - first.checkpoint.nextIndex;
  const parts = [first];
  if (remaining > 0) {
    parts.push(executeResetCycles({ scenario, policy: { ...policy, cycles: remaining }, resume: first.checkpoint }));
  }
  const last = parts[parts.length - 1]!;
  const view = (runs: readonly ResetCycleExecution<N, U, Vars>[], end: ResetCycleExecution<N, U, Vars>) =>
    JSON.stringify({
      economy: snapshotEconomy(E, end.state),
      accumulatedReward: E.toString(end.checkpoint.accumulatedReward),
      elapsedSec: end.checkpoint.elapsedSec,
      nextIndex: end.checkpoint.nextIndex,
      completed: runs.flatMap((run) => run.artifact.cycles.filter((row) => row.resetAtSec !== null)),
    });
  return checkSnapshots(view([continuous], continuous), view(parts, last), "same");
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

/** Inputs of the guarded-advance relation: a constant-income model with no action, evolve, milestone, or seed. */
type GuardedAdvanceCase = Readonly<{
  incomePerSec: number;
  initialMoney: number;
  mode: "drop" | "accumulate";
  stepSec: number;
  durationSec: number;
  chunkSec: number;
  /** Money that meets the goal and the until stop. Null runs to the horizon. */
  goalAmount: number | null;
  maxSteps: number | null;
  fast: boolean;
}>;

/**
 * A declared constant-income interval advanced by exact chunks ends where fixed-step ends.
 * The relation runs the same scenario with `run.advance` omitted and enabled, online and offline, and compares the
 * economy, every traced state, stats, the observation, and the stop. The advanced run must take no fallback step.
 *
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match Runs fixed-step and exact chunks on the same constant-income case and compares wallet, trace, counters, goals, and stop.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match #e92627f Re-read the section: the relation compares the reference and the chunked run online and offline, and an undeclared case does not apply.
 */
export function checkGuardedAdvance(declared: boolean, value: GuardedAdvanceCase): RelationCheck {
  if (!declared) return { ok: true, applicable: false, summary: "guarded advance relation is not declared" };
  const engine = createNumberEngine();
  const unit = { code: "COIN" as const };
  const model: Model<number, "COIN", FlatVars> = {
    id: "conformance-guarded-advance",
    version: 1,
    income: (ctx) => ({ unit: ctx.unit, amount: value.incomePerSec }),
    actions: () => [],
    analytic: () => ({ incomeKind: "constant" }),
  };
  const goal = value.goalAmount;
  const scenario = (advance: boolean): CompiledScenario<number, "COIN", FlatVars> => ({
    ctx: { E: engine, unit, tickPolicy: { mode: value.mode } },
    model,
    initial: {
      t: 0,
      wallet: { money: { unit, amount: value.initialMoney }, bucket: engine.zero() },
      maxMoneyEver: { unit, amount: value.initialMoney },
      prestige: { count: 0, points: engine.zero(), multiplier: engine.from(1) },
      vars: { buys: 0 },
    },
    run: {
      stepSec: value.stepSec,
      durationSec: value.durationSec,
      ...(value.maxSteps !== null ? { maxSteps: value.maxSteps } : {}),
      ...(goal !== null
        ? {
            until: (current: SimState<number, "COIN", FlatVars>) => current.wallet.money.amount >= goal,
            goals: [{ id: "wallet", met: (current: SimState<number, "COIN", FlatVars>) => current.wallet.money.amount >= goal }],
          }
        : {}),
      ...(value.fast ? { fast: { enabled: true, disableMoneyEvents: true } } : {}),
      trace: { everySteps: 1 },
      ...(advance ? { advance: { enabled: true, chunkSec: value.chunkSec } } : {}),
    },
  });
  const view = (result: ReturnType<typeof runScenario<number, "COIN", FlatVars>>) =>
    canonicalJson({
      end: snapshotEconomy(engine, result.end),
      trace: (result.trace ?? []).map((state) => snapshotEconomy(engine, state)),
      stats: result.stats ?? null,
      observation: result.observation ?? null,
      stop: result.stop ?? null,
    });
  const reference = runScenario(scenario(false));
  const chunked = runScenario(scenario(true));
  const offlineScenario = (advance: boolean) => {
    const base = scenario(advance);
    return { ...base, run: { ...base.run, trace: undefined } };
  };
  const offlineOptions = {
    useStrategy: false,
    ...(value.maxSteps !== null ? { maxSteps: value.maxSteps } : {}),
    ...(goal !== null ? { until: (current: SimState<number, "COIN", FlatVars>) => current.wallet.money.amount >= goal } : {}),
  };
  const offlineReference = applyOfflineSeconds({ scenario: offlineScenario(false), seconds: value.durationSec, options: offlineOptions });
  const offlineChunked = applyOfflineSeconds({ scenario: offlineScenario(true), seconds: value.durationSec, options: offlineOptions });
  const exact = (report: typeof chunked.advance) => report?.fallbackSteps === 0 && (report.exactSteps === 0 || report.status === "exact");
  const online = view(chunked) === view(reference);
  const offline = view(offlineChunked) === view(offlineReference);
  return {
    ok: online && offline && exact(chunked.advance) && exact(offlineChunked.advance),
    applicable: true,
    summary: `income ${value.incomePerSec} ${value.mode}, step ${value.stepSec}, horizon ${value.durationSec}, chunk ${value.chunkSec}: online ${online ? "same" : "different"} (${chunked.advance?.status} ${chunked.advance?.exactSteps}/${chunked.advance?.fallbackSteps}), offline ${offline ? "same" : "different"} (${offlineChunked.advance?.status} ${offlineChunked.advance?.exactSteps}/${offlineChunked.advance?.fallbackSteps})`,
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
