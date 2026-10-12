import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";
import { recordPrestigeReset } from "../constraints";
import { emitCommittedResets } from "../observation";
import { applyOfflineSeconds } from "../offline";
import { sessionActiveBlocks, type SessionPatternSpec } from "../session";
import { runScenario } from "../simulator";
import { applyDecisions } from "../step";
import { runElapsedSec, type CompiledScenario, type ScenarioConstraints, type SimContext, type SimState } from "../types";
import {
  executeResetCycles,
  resetAdapterFor,
  type ResetAdapter,
  type ResetCycleCheckpoint,
  type ResetCycleRowV1,
} from "./resetCycle";
import { withoutResetActions } from "./resetActions";

/**
 * Reset policy comparison v1.
 * `analyzePrestigeCycle` stays the legacy interval scan.
 * This artifact does not copy `breakEvenSec` or `stability`.
 */

const RESET_POLICY_ALGORITHM_VERSION = "reset-policy-v1" as const;
const RESET_POLICY_SCHEMA_ID = "https://idlekit.dev/schemas/reset.policy.v1.schema.json" as const;
const MAX_CANDIDATES = 10000;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-reward-rate Realized reward is the committed deltas. The rate uses completed cycle time.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-reward-rate #9ef48a3 Re-read the section: opening points stay out of the delta, and the 5 second tail is not realized reward.
 */
export const resetPolicyRewardRate = "completed-cycle-time-denominator" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-empirical-stability Stable requires the requested windows and both tolerances. A cycle count is not enough.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-empirical-stability #3acf06e Re-read the section: a rising multiplier is drifting, an alternating reward is oscillating, and two cycles stay insufficient.
 */
export const resetPolicyEmpiricalStability = "window-tolerance-not-cycle-count" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-recovery-crossing Recovery time is the threshold crossing. A miss inside the horizon is censored.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-recovery-crossing #28b60db Re-read the section: the climb crosses at 25 seconds, and the short horizon does not substitute min(interval, horizon).
 */
export const resetPolicyRecoveryCrossing = "threshold-crossing-or-censored" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-session-reset A manual reset is committed only inside an active session block.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-session-reset #0ea6f15 Re-read the section: wall 2000 is not a reset, and the caller delay moves the later morning resets.
 */
export const resetPolicySessionReset = "manual-reset-only-while-active" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank Candidates are ranked with Engine.cmp inside the scanned range only.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank #468d46d Re-read the section: infinite toNumber values still rank the larger reward, and a missed goal stays null.
 */
export const resetPolicyScanRank = "engine-compare-scan-range" as const;

export function resetPolicySchemaId(): typeof RESET_POLICY_SCHEMA_ID {
  return RESET_POLICY_SCHEMA_ID;
}

export function resetPolicyAlgorithmVersion(): typeof RESET_POLICY_ALGORITHM_VERSION {
  return RESET_POLICY_ALGORITHM_VERSION;
}

export class ResetPolicyRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetPolicyRejected";
  }
}

export type ResetObjectiveKind = "cumulative-reset-reward" | "final-net-worth" | "goal-reach-sec";

export type RecoveryMetricKind = "pre-reset-income" | "pre-reset-net-worth";

export type EmpiricalStability = "insufficient-data" | "stable" | "drifting" | "non-stationary" | "oscillating";

export type ObjectiveReading = "flow" | "stock" | "time";

export type ResetRecoveryReport = Readonly<{
  metric: RecoveryMetricKind;
  status: "observed" | "censored" | "unsupported";
  seconds: number | null;
  threshold: string;
}>;

export type ResetStabilityReport = Readonly<{
  kind: "empirical";
  provedSteadyState: false;
  status: EmpiricalStability;
  observedCycles: number;
  minObservedCycles: number;
  windows: readonly number[];
  absoluteTolerance: string;
  relativeTolerance: number;
  horizonSec: number;
}>;

export type ResetCandidateReport = Readonly<{
  intervalSec: number;
  status: "ok" | "censored" | "incomplete" | "unsupported";
  completedCycles: number;
  realizedReward: string;
  unrealizedReward: string;
  finalPoints: string;
  finalNetWorth: string;
  rewardRate: string | null;
  rewardRateDenominator: "completed-cycle-time";
  incomplete: Readonly<{ startSec: number; endSec: number; durationSec: number }> | null;
  goalReachSec: number | null;
  goalStatus: "observed" | "censored" | "not-requested";
  recovery: ResetRecoveryReport;
  stability: ResetStabilityReport;
  objectiveValue: string;
  objectiveReading: ObjectiveReading;
  resetWallTimes: readonly number[];
}>;

export type ResetPolicyBest = Readonly<{
  intervalSec: number;
  objective: Readonly<{ kind: ResetObjectiveKind; reading: ObjectiveReading; value: string }>;
  comparison: Readonly<{
    fromSec: number;
    toSec: number;
    stepSec: number;
    horizonSec: number;
    candidateCount: number;
    scope: "scan-range";
    globalOptimum: false;
  }>;
  session: Readonly<{
    assumed: "always-active" | "scheduled";
    patternId: string | null;
    resetDelaySec: number | null;
  }>;
  observation: Readonly<{
    status: EmpiricalStability;
    stability: EmpiricalStability;
    provedSteadyState: false;
    recovery: ResetRecoveryReport["status"];
  }>;
}>;

export type ResetPolicyArtifactV1 = Readonly<{
  schemaVersion: 1;
  algorithmVersion: typeof RESET_POLICY_ALGORITHM_VERSION;
  status: "ok" | "censored" | "incomplete" | "insufficient-data" | "unsupported";
  objective: ResetObjectiveKind;
  scope: "scan-range";
  globalOptimum: false;
  best: ResetPolicyBest;
  candidates: readonly ResetCandidateReport[];
  knownSolution: Readonly<{
    fixtureId: string;
    expectedRate: string;
    observedRate: string;
    matches: boolean;
  }> | null;
  assumptions: readonly string[];
  warnings: readonly string[];
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateResetPolicyArtifactValidator: ((input: unknown) => IValidation<ResetPolicyArtifactV1>) | undefined;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank The generated validator accepts this artifact and rejects a missing scope.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank #468d46d Re-read the section: the wire object is reset policy v1 and globalOptimum stays false.
 */
export const validateResetPolicyArtifact = (input: unknown): IValidation<ResetPolicyArtifactV1> =>
  (validateResetPolicyArtifactValidator ??= typia.createValidate<ResetPolicyArtifactV1>())(input);

function buildResetPolicyJsonSchema() {
  return typia.json.schema<ResetPolicyArtifactV1, "3.1">();
}

let resetPolicyJsonSchemaUnit: ReturnType<typeof buildResetPolicyJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank #468d46d Re-read the section: schema version is 3.1.
 */
export function resetPolicyJsonSchema(): ReturnType<typeof buildResetPolicyJsonSchema> {
  resetPolicyJsonSchemaUnit ??= buildResetPolicyJsonSchema();
  return resetPolicyJsonSchemaUnit;
}

export type ResetPolicyRequest<N, U extends string, Vars> = Readonly<{
  createScenario: () => CompiledScenario<N, U, Vars>;
  scan: Readonly<{ fromSec: number; toSec: number; stepSec: number }>;
  horizonSec: number;
  cycleBudget: number;
  objective: ResetObjectiveKind;
  goal?: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => boolean;
  recovery: Readonly<{ metric: RecoveryMetricKind }>;
  stability: Readonly<{
    minObservedCycles: number;
    windows: readonly number[];
    absoluteTolerance: string;
    relativeTolerance: number;
  }>;
  session?: Readonly<{ pattern: SessionPatternSpec; resetDelaySec: number }>;
  adapter?: ResetAdapter<N, U, Vars>;
  knownSolution?: Readonly<{ fixtureId: string; expectedRate: string }>;
}>;

type Snap = Readonly<{ reward: string; durationSec: number; multiplier: string }>;

/** Goal ids this analysis adds to a run's goals, so the runner reports the first committed state that meets them. */
const GOAL_WATCH_ID = "reset-policy.goal";
const RECOVERY_WATCH_ID = "reset-policy.recovery";

function assertFinite(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResetPolicyRejected(`reset policy ${label} must be a finite number`);
  }
}

function assertStep(value: number): void {
  assertFinite("scan.stepSec", value);
  if (!(value > 0)) throw new ResetPolicyRejected("reset policy scan.stepSec must be a finite number > 0");
}

function scanIntervals(scan: ResetPolicyRequest<never, string, never>["scan"]): number[] {
  assertFinite("scan.fromSec", scan.fromSec);
  assertFinite("scan.toSec", scan.toSec);
  assertStep(scan.stepSec);
  if (!(scan.fromSec > 0) || scan.toSec < scan.fromSec) {
    throw new ResetPolicyRejected("reset policy scan range must be finite and fromSec > 0");
  }
  const steps = (scan.toSec - scan.fromSec) / scan.stepSec;
  if (!Number.isFinite(steps)) throw new ResetPolicyRejected("reset policy scan range is not finite");
  const count = Math.floor(steps + 1e-9) + 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CANDIDATES) {
    throw new ResetPolicyRejected("reset policy scan candidate count must be a safe integer from 1 to 10000");
  }
  const intervals: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const interval = scan.fromSec + index * scan.stepSec;
    if (interval > scan.toSec + scan.stepSec * 1e-9) break;
    intervals.push(interval);
  }
  if (intervals.length === 0) throw new ResetPolicyRejected("reset policy scan produced no candidates");
  return intervals;
}

function assertRequest<N, U extends string, Vars>(request: ResetPolicyRequest<N, U, Vars>): void {
  if (typeof request.createScenario !== "function") {
    throw new ResetPolicyRejected("reset policy createScenario must be a function");
  }
  scanIntervals(request.scan);
  assertFinite("horizonSec", request.horizonSec);
  if (!(request.horizonSec > 0)) throw new ResetPolicyRejected("reset policy horizonSec must be a finite number > 0");
  if (!Number.isInteger(request.cycleBudget) || request.cycleBudget < 1) {
    throw new ResetPolicyRejected("reset policy cycleBudget must be a positive integer");
  }
  // A goal-time objective without a goal has nothing to rank.
  if (request.objective === "goal-reach-sec" && typeof request.goal !== "function") {
    throw new ResetPolicyRejected("reset policy goal-reach-sec needs a goal predicate");
  }
  if (!Number.isInteger(request.stability.minObservedCycles) || request.stability.minObservedCycles < 1) {
    throw new ResetPolicyRejected("reset policy minObservedCycles must be a positive integer");
  }
  if (request.stability.windows.length < 2) {
    throw new ResetPolicyRejected("reset policy stability requires at least two trailing windows");
  }
  for (const window of request.stability.windows) {
    if (!Number.isInteger(window) || window < 2) {
      throw new ResetPolicyRejected("reset policy stability windows must be integers >= 2");
    }
  }
  // Two copies of one window inspect the same samples twice. Agreement needs two distinct windows.
  if (new Set(request.stability.windows).size !== request.stability.windows.length) {
    throw new ResetPolicyRejected("reset policy stability windows must be distinct");
  }
  if (request.stability.absoluteTolerance.trim() === "") {
    throw new ResetPolicyRejected("reset policy absoluteTolerance must be a non-empty amount");
  }
  assertFinite("relativeTolerance", request.stability.relativeTolerance);
  if (request.stability.relativeTolerance < 0) {
    throw new ResetPolicyRejected("reset policy relativeTolerance must be >= 0");
  }
  if (request.session) {
    assertFinite("resetDelaySec", request.session.resetDelaySec);
    if (request.session.resetDelaySec < 0) {
      throw new ResetPolicyRejected("reset policy resetDelaySec must be a finite number >= 0");
    }
  }
}

/** The absolute tolerance in the scenario's engine. It must be a finite amount >= 0. */
function absoluteToleranceOf<N>(E: Engine<N>, text: string): N {
  let amount: N;
  try {
    amount = E.from(text);
  } catch {
    throw new ResetPolicyRejected("reset policy absoluteTolerance must be a finite amount >= 0");
  }
  if (!E.isFinite(amount) || E.cmp(amount, E.zero()) < 0) {
    throw new ResetPolicyRejected("reset policy absoluteTolerance must be a finite amount >= 0");
  }
  return amount;
}

function magnitude<N>(E: Engine<N>, value: N): N {
  return E.cmp(value, E.zero()) < 0 ? E.sub(E.zero(), value) : value;
}

function within<N>(E: Engine<N>, left: N, right: N, absolute: N, relative: number): boolean {
  const delta = magnitude(E, E.sub(left, right));
  if (E.cmp(delta, absolute) <= 0) return true;
  const leftMag = magnitude(E, left);
  const rightMag = magnitude(E, right);
  const scale = E.cmp(leftMag, rightMag) >= 0 ? leftMag : rightMag;
  return E.cmp(delta, E.mul(scale, relative)) <= 0;
}

function diffs<N>(E: Engine<N>, values: readonly N[]): N[] {
  const out: N[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) continue;
    out.push(E.sub(current, previous));
  }
  return out;
}

function moves<N>(E: Engine<N>, step: N, base: N, absolute: N, relative: number): boolean {
  return !within(E, E.add(base, step), base, absolute, relative);
}

function isOscillating<N>(E: Engine<N>, values: readonly N[], absolute: N, relative: number): boolean {
  const steps = diffs(E, values);
  if (steps.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const base = values[index];
    if (step === undefined || base === undefined) return false;
    if (!moves(E, step, base, absolute, relative)) return false;
    const next = E.cmp(step, E.zero());
    if (next === 0 || (sign !== 0 && next === sign)) return false;
    sign = next;
  }
  return true;
}

function isDrifting<N>(E: Engine<N>, values: readonly N[], absolute: N, relative: number): boolean {
  const steps = diffs(E, values);
  if (steps.length < 2) return false;
  let sign = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const base = values[index];
    if (step === undefined || base === undefined) return false;
    if (!moves(E, step, base, absolute, relative)) return false;
    const next = E.cmp(step, E.zero());
    if (next === 0 || (sign !== 0 && next !== sign)) return false;
    sign = next;
  }
  return true;
}

function stationary<N>(E: Engine<N>, values: readonly N[], absolute: N, relative: number): boolean {
  const anchor = values[values.length - 1];
  if (anchor === undefined) return false;
  return values.every((value) => within(E, value, anchor, absolute, relative));
}

function classify<N>(
  E: Engine<N>,
  reward: readonly N[],
  condition: readonly N[],
  spec: ResetPolicyRequest<N, string, unknown>["stability"],
  absolute: N,
): EmpiricalStability {
  if (reward.length < spec.minObservedCycles || condition.length < spec.minObservedCycles) return "insufficient-data";
  const usable = spec.windows.filter((window) => window <= reward.length && window <= condition.length);
  if (usable.length < 2) return "insufficient-data";
  const rewardStable = usable.every((window) => stationary(E, reward.slice(-window), absolute, spec.relativeTolerance));
  const conditionStable = usable.every((window) =>
    stationary(E, condition.slice(-window), absolute, spec.relativeTolerance),
  );
  if (rewardStable && conditionStable) return "stable";
  if (
    isOscillating(E, reward, absolute, spec.relativeTolerance) ||
    isOscillating(E, condition, absolute, spec.relativeTolerance)
  ) {
    return "oscillating";
  }
  if (isDrifting(E, reward, absolute, spec.relativeTolerance) || isDrifting(E, condition, absolute, spec.relativeTolerance)) {
    return "drifting";
  }
  return "non-stationary";
}

/** The scenario context with the live constraints, as runScenario builds it for a step. */
function liveCtx<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  constraints: ScenarioConstraints | undefined,
): SimContext<N, U, Vars> {
  return { ...scenario.ctx, ...(constraints ? { constraints } : {}) };
}

/** Net worth read with the context the simulation used: live constraints, and clocks on a schedule. */
function netWorth<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): N {
  return scenario.model.netWorth?.(ctx, state)?.amount ?? state.wallet.money.amount;
}

function incomeOf<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): N {
  return scenario.model.income(ctx, state).amount;
}

function recoveryMetric<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): N {
  return request.recovery.metric === "pre-reset-income" ? incomeOf(scenario, state, ctx) : netWorth(scenario, state, ctx);
}

/** The adapter where a reset would happen: the request's, or one discovered at this state and context. */
function adapterAt<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  constraints: ScenarioConstraints | undefined,
): ResetAdapter<N, U, Vars> | undefined {
  return request.adapter ?? resetAdapterFor(scenario, undefined, state, liveCtx(scenario, constraints));
}

type Watcher<N, U extends string, Vars> = Readonly<{
  id: string;
  met: (state: SimState<N, U, Vars>) => boolean;
  onMet: (t: number) => void;
}>;

/**
 * The scenario a policy run plays: the caller's goals plus this analysis' watchers, read by the runner on every
 * committed state, and an observer that routes a watcher's first crossing back here. Recording is on, since the
 * runner reads goals only while it records.
 */
function watched<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  watchers: readonly Watcher<N, U, Vars>[],
): CompiledScenario<N, U, Vars> {
  if (watchers.length === 0) return scenario;
  // A caller goal can use any id. Each watcher takes an id no caller goal uses, so a caller goal is never
  // routed to a watcher and a watcher is never marked reached by a caller goal.
  const taken = new Set((scenario.run.goals ?? []).map((goal) => goal.id));
  const byId = new Map<string, Watcher<N, U, Vars>>();
  for (const watcher of watchers) {
    let id = watcher.id;
    for (let suffix = 1; taken.has(id); suffix += 1) id = `${watcher.id}#${suffix}`;
    taken.add(id);
    byId.set(id, watcher);
  }
  const observer = scenario.run.observer;
  return {
    ...scenario,
    run: {
      ...scenario.run,
      observation: { ...scenario.run.observation, enabled: true },
      goals: [...(scenario.run.goals ?? []), ...[...byId].map(([id, watcher]) => ({ id, met: watcher.met }))],
      observer: {
        ...observer,
        onGoal: (fact) => {
          const watcher = byId.get(fact.goalId);
          if (watcher) watcher.onMet(fact.t);
          else observer?.onGoal?.(fact);
        },
      },
    },
  };
}

/**
 * Play without a reset. The reset action is hidden from the strategy, as `executeResetCycles` hides it, so only
 * this analysis commits resets. The run sees the live constraints and, when the model reads them, session clocks.
 */
function play<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  constraints: ScenarioConstraints | undefined,
  adapter: ResetAdapter<N, U, Vars> | undefined,
  durationSec: number,
  until?: (state: SimState<N, U, Vars>) => boolean,
  clocks?: SimContext<N, U, Vars>["clocks"],
) {
  const { maxSteps: _maxSteps, until: _until, trace: _trace, ...runRest } = scenario.run;
  return runScenario({
    ...scenario,
    ...(clocks ? { ctx: { ...scenario.ctx, clocks } } : {}),
    model: withoutResetActions(scenario.model, adapter),
    initial: state,
    ...(constraints ? { constraints } : {}),
    run: {
      ...runRest,
      durationSec,
      ...(until ? { until } : {}),
    },
  });
}

function commitReset<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  constraints: ScenarioConstraints | undefined,
  adapter: ResetAdapter<N, U, Vars>,
  emit: boolean,
):
  | { ok: true; state: SimState<N, U, Vars>; constraints?: ScenarioConstraints; delta: N; t: number }
  | { ok: false; state: SimState<N, U, Vars> } {
  const { E } = scenario.ctx;
  // The adapter and the action see the live constraints, as the reset-cycle executor passes them.
  const ctx = liveCtx(scenario, constraints);
  const before = adapter.reward(ctx, state);
  const action = adapter.action(ctx, state);
  const kinds = new Set<"prestige" | "custom">();
  if (action && (action.kind === "prestige" || action.kind === "custom")) kinds.add(action.kind);
  const applied = applyDecisions({
    ctx,
    model: scenario.model,
    state,
    decisions: action ? [{ action }] : [],
    ...(constraints ? { constraints } : {}),
    resetKinds: kinds,
    // The adapter built this action for this state. A spec or custom adapter action is not in model.actions.
    resolveAgainstModel: false,
  });
  const skipped = applied.events.find((event) => event.type === "action.skipped");
  const fact = applied.committedResets[0];
  if (!fact || skipped) return { ok: false, state };
  let next = applied.state;
  // stepOnce keeps maxMoneyEver at or above the wallet. The boundary action does not pass through it.
  if (E.cmp(next.wallet.money.amount, next.maxMoneyEver.amount) > 0) next = { ...next, maxMoneyEver: next.wallet.money };
  const delta = E.sub(adapter.reward(ctx, next), before);
  const nextConstraints =
    action?.kind === "prestige"
      ? recordPrestigeReset(constraints, fact.t, emit ? scenario.run.onPrestigeReset : undefined)
      : constraints;
  if (emit) emitCommittedResets(scenario.run.observer, [{ ...fact, rewardDelta: E.toString(delta) }]);
  return { ok: true, state: next, ...(nextConstraints ? { constraints: nextConstraints } : {}), delta, t: fact.t };
}

function sumAmounts<N>(E: Engine<N>, amounts: readonly N[]): N {
  return amounts.reduce((total, amount) => E.add(total, amount), E.zero());
}

function stabilityReport<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  snaps: readonly Snap[],
  request: ResetPolicyRequest<N, U, Vars>,
): ResetStabilityReport {
  const { E } = scenario.ctx;
  const absolute = absoluteToleranceOf(E, request.stability.absoluteTolerance);
  const status = classify(
    E,
    snaps.map((snap) => E.from(snap.reward)),
    snaps.map((snap) => E.from(snap.multiplier)),
    request.stability,
    absolute,
  );
  return {
    kind: "empirical",
    provedSteadyState: false,
    status,
    observedCycles: snaps.length,
    minObservedCycles: request.stability.minObservedCycles,
    windows: request.stability.windows,
    absoluteTolerance: request.stability.absoluteTolerance,
    relativeTolerance: request.stability.relativeTolerance,
    horizonSec: request.horizonSec,
  };
}

/** Recovery for an always-active candidate: one reset at intervalSec, then play without resets to the horizon. */
function recover<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  intervalSec: number,
): ResetRecoveryReport {
  const scenario = request.createScenario();
  const { E } = scenario.ctx;
  const blank = E.toString(E.zero());
  // horizonSec is elapsed time from the scenario origin, as executeResetCycles reads it.
  if (!(intervalSec <= request.horizonSec)) {
    return { metric: request.recovery.metric, status: "censored", seconds: null, threshold: blank };
  }
  const constraints = scenario.constraints;
  const lead = play(scenario, scenario.initial, constraints, adapterAt(request, scenario, scenario.initial, constraints), intervalSec);
  const threshold = recoveryMetric(request, scenario, lead.end, liveCtx(scenario, constraints));
  // Resolve the adapter where the reset happens. A prestige action can appear only after the lead.
  const adapter = adapterAt(request, scenario, lead.end, constraints);
  if (!adapter) return { metric: request.recovery.metric, status: "unsupported", seconds: null, threshold: blank };
  const committed = commitReset(scenario, lead.end, constraints, adapter, false);
  if (!committed.ok) {
    return { metric: request.recovery.metric, status: "unsupported", seconds: null, threshold: E.toString(threshold) };
  }
  const remaining = request.horizonSec - runElapsedSec(lead);
  const afterCtx = liveCtx(scenario, committed.constraints);
  if (!(remaining > 0)) {
    if (E.cmp(recoveryMetric(request, scenario, committed.state, afterCtx), threshold) >= 0) {
      return { metric: request.recovery.metric, status: "observed", seconds: 0, threshold: E.toString(threshold) };
    }
    return { metric: request.recovery.metric, status: "censored", seconds: null, threshold: E.toString(threshold) };
  }
  const search = play(scenario, committed.state, committed.constraints, adapter, remaining, (state) =>
    E.cmp(recoveryMetric(request, scenario, state, afterCtx), threshold) >= 0,
  );
  if (E.cmp(recoveryMetric(request, scenario, search.end, afterCtx), threshold) < 0) {
    return { metric: request.recovery.metric, status: "censored", seconds: null, threshold: E.toString(threshold) };
  }
  return {
    metric: request.recovery.metric,
    status: "observed",
    seconds: search.end.t - committed.state.t,
    threshold: E.toString(threshold),
  };
}

function unrealizedAt<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  constraints: ScenarioConstraints | undefined,
): N {
  // The dry run sees the constraints the committed resets left, so a cooldown still blocks it.
  const adapter = adapterAt(request, scenario, state, constraints);
  if (!adapter) return scenario.ctx.E.zero();
  const committed = commitReset(scenario, state, constraints, adapter, false);
  return committed.ok ? committed.delta : scenario.ctx.E.zero();
}

function objectiveOf(
  kind: ResetObjectiveKind,
  realized: string,
  worth: string,
  goalReachSec: number | null,
  goalStatus: ResetCandidateReport["goalStatus"],
): { value: string; reading: ObjectiveReading } {
  if (kind === "final-net-worth") return { value: worth, reading: "stock" };
  if (kind === "goal-reach-sec") {
    return goalStatus === "observed" && goalReachSec !== null
      ? { value: String(goalReachSec), reading: "time" }
      : { value: "censored", reading: "time" };
  }
  return { value: realized, reading: "flow" };
}

function candidateFrom<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  scenario: CompiledScenario<N, U, Vars>,
  intervalSec: number,
  status: ResetCandidateReport["status"],
  snaps: readonly Snap[],
  end: SimState<N, U, Vars>,
  incomplete: ResetCandidateReport["incomplete"],
  unrealized: N,
  goalReachSec: number | null,
  walls: readonly number[],
  recovery: ResetRecoveryReport,
  endCtx: SimContext<N, U, Vars>,
): ResetCandidateReport {
  const { E } = scenario.ctx;
  const completed = snaps;
  const realized = sumAmounts(
    E,
    completed.map((snap) => E.from(snap.reward)),
  );
  const cycleTime = completed.reduce((total, snap) => total + snap.durationSec, 0);
  const rewardRate = cycleTime > 0 ? E.toString(E.div(realized, cycleTime)) : null;
  const goalStatus: ResetCandidateReport["goalStatus"] = request.goal
    ? goalReachSec === null
      ? "censored"
      : "observed"
    : "not-requested";
  const worth = netWorth(scenario, end, endCtx);
  const objective = objectiveOf(request.objective, E.toString(realized), E.toString(worth), goalReachSec, goalStatus);
  return {
    intervalSec,
    status,
    completedCycles: completed.length,
    realizedReward: E.toString(realized),
    unrealizedReward: E.toString(unrealized),
    finalPoints: E.toString(end.prestige.points),
    finalNetWorth: E.toString(worth),
    rewardRate,
    rewardRateDenominator: "completed-cycle-time",
    incomplete,
    goalReachSec,
    goalStatus,
    recovery,
    stability: stabilityReport(scenario, completed, request),
    objectiveValue: objective.value,
    objectiveReading: objective.reading,
    resetWallTimes: walls,
  };
}

/** A goal watcher that keeps the first reward time the goal holds on a committed state. */
function goalWatcher<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  ctxNow: () => SimContext<N, U, Vars>,
  onMet: (t: number) => void,
): Watcher<N, U, Vars>[] {
  const goal = request.goal;
  if (!goal) return [];
  return [{ id: GOAL_WATCH_ID, met: (state) => goal(ctxNow(), state), onMet }];
}

function evaluateAlwaysActive<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  intervalSec: number,
): { report: ResetCandidateReport; engine: Engine<N> } {
  const scenario = request.createScenario();
  const { E } = scenario.ctx;
  absoluteToleranceOf(E, request.stability.absoluteTolerance);
  const recovery = recover(request, intervalSec);
  const reached: { t: number | null } = { t: null };
  let constraints = scenario.constraints;
  // Constraints change only at a boundary, so the context of the next interval is known before it runs.
  let metricCtx = liveCtx(scenario, constraints);
  // The runner reads the goal on every committed state, so a crossing between resets keeps its own time.
  const observed = watched(
    scenario,
    goalWatcher(
      request,
      () => metricCtx,
      (t) => {
        if (reached.t === null) reached.t = t;
      },
    ),
  );
  const snaps: Snap[] = [];
  let resume: ResetCycleCheckpoint<N, U, Vars> | undefined;
  let state = scenario.initial;
  let elapsed = 0;
  // The span after the last committed reset is not a completed cycle, refused intervals included.
  let lastResetT = state.t;
  let elapsedAtLastReset = 0;
  let refused = false;
  let unsupported = false;
  while (snaps.length < request.cycleBudget) {
    metricCtx = liveCtx(scenario, constraints);
    // The executor resolves the adapter at each boundary, so a prestige action unlocked during the interval counts.
    const step = executeResetCycles({
      scenario: observed,
      policy: { kind: "fixed-interval", intervalSec, cycles: 1 },
      horizonSec: request.horizonSec,
      ...(request.adapter ? { adapter: request.adapter } : {}),
      ...(resume ? { resume } : {}),
    });
    const row: ResetCycleRowV1 | undefined = step.artifact.cycles[0];
    state = step.state;
    constraints = step.constraints;
    resume = step.checkpoint;
    elapsed = step.artifact.globalElapsedSec;
    if (step.artifact.status === "unsupported") {
      unsupported = true;
      break;
    }
    if (!row || row.resetAtSec === null) {
      refused = row?.resetSkippedReason !== undefined;
      break;
    }
    snaps.push({ reward: row.rewardDelta, durationSec: row.durationSec, multiplier: row.carried.multiplier });
    lastResetT = state.t;
    elapsedAtLastReset = elapsed;
  }
  metricCtx = liveCtx(scenario, constraints);
  // horizonSec is elapsed time from the scenario origin. The tail is what the cycles did not play.
  const tail = request.horizonSec - elapsed;
  if (tail > 1e-9 * Math.max(1, request.horizonSec)) {
    const played = play(observed, state, constraints, adapterAt(request, scenario, state, constraints), tail);
    state = played.end;
    elapsed += runElapsedSec(played);
  }
  const openSec = elapsed - elapsedAtLastReset;
  const incomplete: ResetCandidateReport["incomplete"] =
    openSec > 1e-9 * Math.max(1, request.horizonSec) ? { startSec: lastResetT, endSec: state.t, durationSec: openSec } : null;
  // A goal met only by the last committed reset has no later run to read it.
  if (request.goal && reached.t === null && request.goal(metricCtx, state)) reached.t = state.t;
  const unrealized = incomplete ? unrealizedAt(request, scenario, state, constraints) : E.zero();
  const status: ResetCandidateReport["status"] =
    unsupported && snaps.length === 0
      ? "unsupported"
      : refused || unsupported
        ? "incomplete"
        : snaps.length === 0
          ? "censored"
          : "ok";
  return {
    engine: E,
    report: candidateFrom(
      request,
      scenario,
      intervalSec,
      status,
      snaps,
      state,
      incomplete,
      unrealized,
      reached.t,
      [],
      recovery,
      metricCtx,
    ),
  };
}

type ScheduleOutcome<N, U extends string, Vars> = Readonly<{
  snaps: readonly Snap[];
  walls: readonly number[];
  state: SimState<N, U, Vars>;
  constraints: ScenarioConstraints | undefined;
  refused: boolean;
  unsupported: boolean;
  /** Wall time where the last active block ended. The span after it to the horizon is not a reset window. */
  activeWallEnd: number;
  /** The context at the horizon: live constraints, and clocks when the model reads them. */
  endCtx: SimContext<N, U, Vars>;
  goalReachSec: number | null;
  recovery: Readonly<{ threshold: N; resetT: number; crossedT: number | null }> | null;
}>;

/**
 * Play the session schedule once. Active blocks run with clocks when the model reads them, a manual reset commits
 * only inside a block, and the gaps between blocks apply the scenario's offline progression, as
 * `simulateSessionPattern` does. Reaching the cycle budget, a refusal, or a missing adapter stops further resets,
 * not the schedule, so every candidate is played to the same horizon.
 */
function playSchedule<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  scenario: CompiledScenario<N, U, Vars>,
  intervalSec: number,
  options: Readonly<{ budget: number; emit: boolean; watchRecovery: boolean; watchGoal: boolean }>,
): ScheduleOutcome<N, U, Vars> {
  const session = request.session;
  if (!session) throw new ResetPolicyRejected("reset policy session is missing");
  const { E } = scenario.ctx;
  const originT = scenario.initial.t;
  const blocks = sessionActiveBlocks(session.pattern)
    .map((block) => {
      const start = block.day * 86400 + block.startOffsetSec;
      return { start, end: Math.min(start + block.durationSec, request.horizonSec) };
    })
    .filter((block) => block.end > block.start);
  let state = scenario.initial;
  let constraints = scenario.constraints;
  let wall = 0;
  let activeSec = 0;
  let lastResetWall = 0;
  let resetsOpen = true;
  let refused = false;
  let unsupported = false;
  const snaps: Snap[] = [];
  const walls: number[] = [];
  const reached: { t: number | null } = { t: null };
  let recovery: { threshold: N; resetT: number; crossedT: number | null } | null = null;
  const clocksFor = (wallStart: number, wallEnd: number): SimContext<N, U, Vars>["clocks"] | undefined =>
    (scenario.model.clocks?.respondsTo?.length ?? 0) > 0
      ? { wallT: originT + wallStart, wallEndT: originT + wallEnd, rewardT: state.t, activeT: activeSec }
      : undefined;
  // The context a segment starting at this wall time would see. Watchers read the context of the running segment.
  const ctxAt = (wallEnd: number): SimContext<N, U, Vars> => {
    const clocks = clocksFor(wall, wallEnd);
    return { ...liveCtx(scenario, constraints), ...(clocks ? { clocks } : {}) };
  };
  let segmentCtx = ctxAt(wall);
  const watchers: Watcher<N, U, Vars>[] = options.watchGoal
    ? goalWatcher(
        request,
        () => segmentCtx,
        (t) => {
          if (reached.t === null) reached.t = t;
        },
      )
    : [];
  const runActive = (durationSec: number) => {
    segmentCtx = ctxAt(wall + durationSec);
    const played = play(
      watched(scenario, watchers),
      state,
      constraints,
      adapterAt(request, scenario, state, constraints),
      durationSec,
      undefined,
      clocksFor(wall, wall + durationSec),
    );
    activeSec += runElapsedSec(played);
    state = played.end;
    wall += durationSec;
  };
  const runOffline = (toWall: number) => {
    if (!(wall < toWall)) return;
    segmentCtx = ctxAt(toWall);
    const clocks = clocksFor(wall, toWall);
    const base = watched(scenario, watchers);
    const offline = applyOfflineSeconds({
      scenario: {
        ...base,
        ...(clocks ? { ctx: { ...base.ctx, clocks } } : {}),
        model: withoutResetActions(base.model, adapterAt(request, scenario, state, constraints)),
        ...(constraints ? { constraints } : {}),
      },
      seconds: toWall - wall,
      options: {
        fromState: state,
        actions: scenario.run.offline?.actions ?? { mode: "legacy-all" },
        fast: scenario.run.fast,
        policy: scenario.run.offline,
      },
    });
    state = offline.end;
    wall = toWall;
  };

  for (const block of blocks) {
    runOffline(block.start);
    if (wall < block.start) wall = block.start;
    while (resetsOpen && snaps.length < options.budget) {
      const at = Math.max(lastResetWall + intervalSec, wall);
      if (!(at < block.end)) break;
      if (at > wall) runActive(at - wall);
      const adapter = adapterAt(request, scenario, state, constraints);
      if (!adapter) {
        unsupported = true;
        resetsOpen = false;
        break;
      }
      const threshold = recoveryMetric(request, scenario, state, ctxAt(block.end));
      const committed = commitReset(scenario, state, constraints, adapter, options.emit);
      if (!committed.ok) {
        refused = true;
        resetsOpen = false;
        break;
      }
      // Reset eligibility and the horizon are wall time, so a cycle lasts from the previous reset wall to this one,
      // reset delay and capped offline time included.
      snaps.push({
        reward: E.toString(committed.delta),
        durationSec: at - lastResetWall,
        multiplier: E.toString(committed.state.prestige.multiplier),
      });
      state = committed.state;
      constraints = committed.constraints;
      walls.push(at);
      if (options.watchRecovery && recovery === null) {
        const found = { threshold, resetT: committed.t, crossedT: null as number | null };
        recovery = found;
        if (E.cmp(recoveryMetric(request, scenario, state, ctxAt(block.end)), threshold) >= 0) found.crossedT = committed.t;
        else {
          watchers.push({
            id: RECOVERY_WATCH_ID,
            met: (next) => E.cmp(recoveryMetric(request, scenario, next, segmentCtx), threshold) >= 0,
            onMet: (t) => {
              if (found.crossedT === null) found.crossedT = t;
            },
          });
        }
      }
      lastResetWall = at;
      // The caller's delay advances wall time and grants no income.
      wall = at + session.resetDelaySec;
    }
    if (wall < block.end) runActive(block.end - wall);
  }
  const activeWallEnd = wall;
  // The rest of the horizon is away time and applies the offline progression.
  runOffline(request.horizonSec);
  const endCtx = ctxAt(wall);
  const goal = request.goal;
  if (options.watchGoal && goal && reached.t === null && goal(endCtx, state)) reached.t = state.t;
  return {
    snaps,
    walls,
    state,
    constraints,
    refused,
    unsupported,
    activeWallEnd,
    endCtx,
    goalReachSec: reached.t,
    recovery,
  };
}

function evaluateSession<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
  intervalSec: number,
): { report: ResetCandidateReport; engine: Engine<N> } {
  const scenario = request.createScenario();
  const { E } = scenario.ctx;
  absoluteToleranceOf(E, request.stability.absoluteTolerance);
  // Recovery is measured on this candidate's own schedule: its first committed reset, then no further resets.
  const probe = playSchedule(request, request.createScenario(), intervalSec, {
    budget: 1,
    emit: false,
    watchRecovery: true,
    watchGoal: false,
  });
  const blank = E.toString(E.zero());
  const recovery: ResetRecoveryReport = probe.recovery
    ? {
        metric: request.recovery.metric,
        status: probe.recovery.crossedT === null ? "censored" : "observed",
        seconds: probe.recovery.crossedT === null ? null : probe.recovery.crossedT - probe.recovery.resetT,
        threshold: E.toString(probe.recovery.threshold),
      }
    : {
        metric: request.recovery.metric,
        status: probe.refused || probe.unsupported ? "unsupported" : "censored",
        seconds: null,
        threshold: blank,
      };
  const outcome = playSchedule(request, scenario, intervalSec, {
    budget: request.cycleBudget,
    emit: true,
    watchRecovery: false,
    watchGoal: true,
  });
  const incomplete =
    outcome.activeWallEnd + 1e-9 < request.horizonSec
      ? { startSec: outcome.activeWallEnd, endSec: request.horizonSec, durationSec: request.horizonSec - outcome.activeWallEnd }
      : null;
  // A manual reset needs an active block. When the horizon falls in an offline span there is nothing to realize.
  const activeAtHorizon = outcome.activeWallEnd + 1e-9 >= request.horizonSec;
  const unrealized = activeAtHorizon ? unrealizedAt(request, scenario, outcome.state, outcome.constraints) : E.zero();
  const status: ResetCandidateReport["status"] =
    outcome.unsupported && outcome.snaps.length === 0
      ? "unsupported"
      : outcome.refused || outcome.unsupported
        ? "incomplete"
        : outcome.snaps.length === 0
          ? "censored"
          : "ok";
  return {
    engine: E,
    report: candidateFrom(
      request,
      scenario,
      intervalSec,
      status,
      outcome.snaps,
      outcome.state,
      incomplete,
      unrealized,
      outcome.goalReachSec,
      outcome.walls,
      recovery,
      outcome.endCtx,
    ),
  };
}

function better<N>(kind: ResetObjectiveKind, left: ResetCandidateReport, right: ResetCandidateReport, E: Engine<N>): boolean {
  if (left.status === "unsupported") return false;
  if (right.status === "unsupported") return true;
  if (kind === "goal-reach-sec") {
    if (left.goalStatus !== "observed" || left.goalReachSec === null) return false;
    if (right.goalStatus !== "observed" || right.goalReachSec === null) return true;
    return left.goalReachSec < right.goalReachSec;
  }
  if (left.objectiveValue === "censored") return false;
  if (right.objectiveValue === "censored") return true;
  return E.cmp(E.from(left.objectiveValue), E.from(right.objectiveValue)) > 0;
}

/**
 * Compare reset intervals on one horizon.
 * Each candidate starts from `createScenario`. Completed resets stay separate from the trailing uncommitted span.
 *
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-reward-rate The comparison ranks committed reward and leaves the tail unrealized.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-reward-rate #9ef48a3 Re-read the section: four resets realize 4, and the unfinished span does not join that total.
 */
export function analyzeResetPolicies<N, U extends string, Vars>(
  request: ResetPolicyRequest<N, U, Vars>,
): ResetPolicyArtifactV1 {
  assertRequest(request);
  const intervals = scanIntervals(request.scan);
  const evaluated = intervals.map((interval) =>
    request.session ? evaluateSession(request, interval) : evaluateAlwaysActive(request, interval),
  );
  const first = evaluated[0];
  if (!first) throw new ResetPolicyRejected("reset policy scan produced no candidates");
  let bestIndex = 0;
  for (let index = 1; index < evaluated.length; index += 1) {
    const candidate = evaluated[index];
    const winner = evaluated[bestIndex];
    if (!candidate || !winner) continue;
    if (better(request.objective, candidate.report, winner.report, first.engine)) bestIndex = index;
  }
  const bestEval = evaluated[bestIndex] ?? first;
  const bestReport = bestEval.report;
  const known = request.knownSolution
    ? {
        fixtureId: request.knownSolution.fixtureId,
        expectedRate: request.knownSolution.expectedRate,
        observedRate: bestReport.rewardRate ?? "",
        matches:
          bestReport.rewardRate !== null &&
          bestEval.engine.cmp(bestEval.engine.from(bestReport.rewardRate), bestEval.engine.from(request.knownSolution.expectedRate)) ===
            0,
      }
    : null;
  const assumptions = [
    "realized reward sums committed reset deltas and excludes stock already held",
    "reward rate divides that sum by completed cycle time, not by stock or the horizon",
    "unrealized reward is the uncommitted reset after the incomplete span and is not ranked",
    "recovery seconds are the first threshold crossing inside the horizon, otherwise censored",
    "each candidate starts from createScenario",
    "empirical window agreement is not a proof of a steady state",
  ];
  if (request.session) {
    assumptions.push("manual reset is committed only inside an active session block");
    assumptions.push("resetDelaySec is the caller input, advances wall time, and grants no income");
    assumptions.push("offline gaps apply the scenario's offline progression and do not commit a reset");
    assumptions.push("the cycle budget or a refused reset stops further resets, not the schedule");
  }
  const censoredGoal = request.objective === "goal-reach-sec" && bestReport.goalStatus === "censored";
  // A winner that stopped on a refusal did not finish its requested evaluation, so the artifact is not ok.
  const status: ResetPolicyArtifactV1["status"] = evaluated.every((entry) => entry.report.status === "unsupported")
    ? "unsupported"
    : bestReport.status === "censored" || censoredGoal
      ? "censored"
      : bestReport.status === "incomplete"
        ? "incomplete"
        : bestReport.stability.status === "insufficient-data"
          ? "insufficient-data"
          : "ok";
  return {
    schemaVersion: 1,
    algorithmVersion: RESET_POLICY_ALGORITHM_VERSION,
    status,
    objective: request.objective,
    scope: "scan-range",
    globalOptimum: false,
    best: {
      intervalSec: bestReport.intervalSec,
      objective: {
        kind: request.objective,
        reading: bestReport.objectiveReading,
        value: bestReport.objectiveValue,
      },
      comparison: {
        fromSec: request.scan.fromSec,
        toSec: request.scan.toSec,
        stepSec: request.scan.stepSec,
        horizonSec: request.horizonSec,
        candidateCount: evaluated.length,
        scope: "scan-range",
        globalOptimum: false,
      },
      session: {
        assumed: request.session ? "scheduled" : "always-active",
        patternId: request.session?.pattern.id ?? null,
        resetDelaySec: request.session?.resetDelaySec ?? null,
      },
      observation: {
        status: bestReport.stability.status,
        stability: bestReport.stability.status,
        provedSteadyState: false,
        recovery: bestReport.recovery.status,
      },
    },
    candidates: evaluated.map((entry) => entry.report),
    knownSolution: known,
    assumptions,
    warnings: [
      "legacy breakEvenSec and stability are not this artifact",
      "empirical window agreement is not a mathematical steady state",
      "the best candidate is the scan-range winner, not a global optimum",
    ],
  };
}
