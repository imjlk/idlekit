import typia, { type IValidation } from "typia";
import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import { exactAmountSign } from "./step";
import { nextBoundary, stepContext } from "./timeBoundary";
import type { Model, SimContext, SimState } from "./types";
import type { Strategy } from "./strategy/types";

/**
 * Opt-in analytic advance. Fixed-step stays the reference.
 * An unclear evolve, purchase, reset, seed, buff, or capacity boundary refuses the chunk.
 */

const ADVANCE_SCHEMA_ID = "https://idlekit.dev/schemas/advance.v1.schema.json" as const;
const ADVANCE_ALGORITHM_VERSION = "guarded-advance-1" as const;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The published schema id is the advance report.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: the id is the advance v1 schema.
 */
export function advanceSchemaId(): typeof ADVANCE_SCHEMA_ID {
  return ADVANCE_SCHEMA_ID;
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The algorithm version is guarded-advance-1.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: the version string is guarded-advance-1.
 */
export function advanceAlgorithmVersion(): typeof ADVANCE_ALGORITHM_VERSION {
  return ADVANCE_ALGORITHM_VERSION;
}

export type AdvanceReportV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.advance.v1";
  algorithmVersion: typeof ADVANCE_ALGORITHM_VERSION;
  capability: "statically-known" | "unsupported" | "unknown";
  requested: "exact" | "approximation";
  status: "exact" | "fallback";
  reason: string;
  tolerance: string | null;
  exactSteps: number;
  fallbackSteps: number;
  chunks: number;
  observation: "equivalent" | "degraded";
  seedSchedule: "unchanged";
  externalProvider: false;
}>;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback An unclear boundary stays on fixed-step.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: evolve, purchase, strategy, reset, milestone, capacity, session clock, emit, and a non-empty bucket refuse the chunk.
 */
export const advanceGuardedFallback = "unclear-boundary-uses-fixed-step" as const;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match Constant income matches the reference wallet, goal time, and counters.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match #e92627f Re-read the section: chunk size does not change the reference result.
 */
export const advanceExactMatch = "constant-income-matches-reference" as const;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-policy-boundary A tick threshold is not treated as one large delta.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-policy-boundary #fe9aa0a Re-read the section: drop and accumulate thresholds fall back.
 */
export const advancePolicyThreshold = "threshold-is-not-composed" as const;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-stochastic A seeded model does not advance without a capability.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-stochastic #63e1126 Re-read the section: a seed stays on fixed-step.
 */
export const advanceStochasticSeed = "seed-without-capability-stays-fixed" as const;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-observation-facts Fast event omission still keeps money facts.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-observation-facts #7eaece6 Re-read the section: omitted events are not stored as measured zeros.
 */
export const advanceFactsKept = "fast-events-keep-observation-facts" as const;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-measured-bench A horizon is timed before any speedup is stated.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-measured-bench #993ad19 Re-read the section: 30d and 90d are measured, and memory is recorded.
 */
export const advanceMeasuredBench = "no-unmeasured-speedup" as const;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateAdvanceReportValidator: ((input: unknown) => IValidation<AdvanceReportV1>) | undefined;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The published validator is createValidate of the advance report.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: the structural document is AdvanceReportV1.
 */
export const validateAdvanceReport = (input: unknown): IValidation<AdvanceReportV1> =>
  (validateAdvanceReportValidator ??= typia.createValidate<AdvanceReportV1>())(input);

function buildAdvanceJsonSchema() {
  return typia.json.schema<AdvanceReportV1, "3.1">();
}

let advanceJsonSchemaUnit: ReturnType<typeof buildAdvanceJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: schema version is 3.1 and the contract id is idlekit.advance.v1.
 */
export function advanceJsonSchema(): ReturnType<typeof buildAdvanceJsonSchema> {
  advanceJsonSchemaUnit ??= buildAdvanceJsonSchema();
  return advanceJsonSchemaUnit;
}

type AdvanceLedger = {
  requested: "exact" | "approximation";
  tolerance: string | null;
  exactSteps: number;
  fallbackSteps: number;
  chunks: number;
  reasons: string[];
};

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The ledger counts exact steps and fallback steps separately.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: an approximation request is not applied.
 */
export function createAdvanceLedger(requested: AdvanceLedger["requested"], tolerance: string | null): AdvanceLedger {
  return { requested, tolerance, exactSteps: 0, fallbackSteps: 0, chunks: 0, reasons: [] };
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The report separates an exact chunk from a fixed-step fallback.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: a fallback reason is kept, and the seed schedule is unchanged.
 */
export function finishAdvanceReport(ledger: AdvanceLedger, capability: AdvanceReportV1["capability"]): AdvanceReportV1 {
  const unique = [...new Set(ledger.reasons)];
  const exact = ledger.fallbackSteps === 0 && ledger.exactSteps > 0 && ledger.requested === "exact";
  return {
    schemaVersion: 1,
    contract: "idlekit.advance.v1",
    algorithmVersion: ADVANCE_ALGORITHM_VERSION,
    capability,
    requested: ledger.requested,
    status: exact ? "exact" : "fallback",
    reason: exact ? "constant income matched the reference step" : unique[0] ?? "fixed-step reference",
    tolerance: ledger.requested === "approximation" ? ledger.tolerance : null,
    exactSteps: ledger.exactSteps,
    fallbackSteps: ledger.fallbackSteps,
    chunks: ledger.chunks,
    observation: ledger.requested === "approximation" ? "degraded" : "equivalent",
    seedSchedule: "unchanged",
    externalProvider: false,
  };
}

/**
 * What the report says the model can do, read once from the start state.
 *
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback The report names the advance capability next to the fallback reason.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-guarded-fallback #5b4bffc Re-read the section: the report contract is idlekit.advance.v1, and it carries this capability beside the fallback reason.
 */
export function advanceCapabilityOf<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
): AdvanceReportV1["capability"] {
  if (!model.analytic) return "unsupported";
  const hint = model.analytic(ctx, state);
  if (!hint) return "unknown";
  return hint.incomeKind === "constant" ? "statically-known" : "unsupported";
}

export type AdvanceGateArgs<N, U extends string, Vars> = Readonly<{
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;
  dt: number;
  requested: "exact" | "approximation";
  strategy?: Strategy<N, U, Vars>;
}>;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-policy-boundary Refusal names the boundary that fixed-step must keep.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-policy-boundary #fe9aa0a Re-read the section: a threshold, a seed, or a session clock refuses the chunk.
 */
export function refusalForAdvance<N, U extends string, Vars>(args: AdvanceGateArgs<N, U, Vars>): string | null {
  return certifyAdvance(args).reason;
}

/**
 * A certified step keeps the income the guard read, the state it projected, and the income at that state,
 * so applying the step calls `model.income` no more than the guard did.
 */
type Certified<N, U extends string, Vars> =
  | Readonly<{ reason: string }>
  | Readonly<{ reason: null; income: Money<N, U>; next: SimState<N, U, Vars>; nextIncome: Money<N, U> }>;

/**
 * The guard behind `refusalForAdvance`. `current` is the income already read for this state and context,
 * which a chunk carries from the previous step's projection.
 */
function certifyAdvance<N, U extends string, Vars>(
  args: AdvanceGateArgs<N, U, Vars>,
  current?: Money<N, U>,
): Certified<N, U, Vars> {
  const reason = (text: string): Certified<N, U, Vars> => ({ reason: text });
  if (args.requested === "approximation") return reason("approximation is not applied");
  if (args.ctx.seed !== undefined) return reason("seeded model has no advance capability");
  if (args.ctx.clocks !== undefined) return reason("scheduled session boundary");
  if (args.ctx.tickPolicy.maxLogGap !== undefined) return reason("tick policy threshold is not compositionally equivalent");
  if (args.ctx.emit) return reason("event emitter receives each tick");
  if (args.model.evolve) return reason("evolve is not in the exact interval");
  if (args.model.prestige) return reason("reset is not in the exact interval");
  if (args.model.milestones) return reason("milestone boundary is not in the exact interval");
  if (args.strategy) return reason("purchase strategy is not in the exact interval");
  if (!args.model.analytic) return reason("advance capability is unsupported");
  const hint = args.model.analytic(args.ctx, args.state);
  if (!hint) return reason("advance capability is unknown");
  if (hint.incomeKind !== "constant") return reason("income kind is not constant");
  if (hint.softcap) return reason("capacity boundary is not in the exact interval");
  if (args.model.actions(args.ctx, args.state).length > 0) return reason("purchase is available");
  // `cmp` calls an epsilon-sized bucket empty. A fixed-step tick would still flush it.
  if (exactAmountSign(args.ctx.E, args.state.wallet.bucket) !== 0) return reason("money bucket is not empty");
  const income = current ?? args.model.income(args.ctx, args.state);
  if (income.unit.code !== args.state.wallet.money.unit.code) return reason("income unit does not match the wallet");
  const next = applyExactIncome(args.ctx.E, args.state, income.amount, args.dt, args.ctx.tickPolicy.mode);
  const nextIncome = args.model.income(args.ctx, next);
  if (args.ctx.E.cmp(nextIncome.amount, income.amount) !== 0) return reason("income changed inside the interval");
  return { reason: null, income, next, nextIncome };
}

/**
 * The amount one tick applies, as the tick policy without `maxLogGap` applies it: drop adds the scaled income,
 * and accumulate adds the bucket plus that income.
 */
function appliedDelta<N>(E: Engine<N>, bucket: N, incomePerSec: N, dt: number, mode: "drop" | "accumulate"): N {
  const scaled = E.mul(incomePerSec, dt);
  return mode === "accumulate" ? E.add(bucket, scaled) : scaled;
}

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match Constant income is added with the engine, not a narrowed number.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match #e92627f Re-read the section: wallet and max money use the engine add.
 */
export function applyExactIncome<N, U extends string, Vars>(
  E: Engine<N>,
  state: SimState<N, U, Vars>,
  incomePerSec: N,
  dt: number,
  mode: "drop" | "accumulate" = "drop",
): SimState<N, U, Vars> {
  const amount = E.add(state.wallet.money.amount, appliedDelta(E, state.wallet.bucket, incomePerSec, dt, mode));
  const money = { unit: state.wallet.money.unit, amount };
  // An applied tick leaves an empty bucket under either policy.
  const next: SimState<N, U, Vars> = {
    ...state,
    wallet: { money, bucket: E.zero() },
    t: state.t + dt,
  };
  if (E.cmp(amount, state.maxMoneyEver.amount) > 0) {
    return { ...next, maxMoneyEver: money };
  }
  return next;
}

export type ExactSample<N, U extends string, Vars> = Readonly<{
  t0: number;
  t1: number;
  dt: number;
  state: SimState<N, U, Vars>;
  rewarded: boolean;
}>;

export type ExactChunk<N, U extends string, Vars> =
  | Readonly<{ ok: true; state: SimState<N, U, Vars>; steps: number }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Take whole reference steps while each one is certified, up to `chunkSec` of them.
 * Each step comes from `nextBoundary` on the runner's summed clock, so the dt grid, the horizon epsilon, the goal,
 * and the step budget are the fixed-step ones. A chunk always takes its first step, so a `chunkSec` below one step
 * is one step. The runner's own boundary check stops or throws after the chunk, as it would after that step.
 * Each step is handed to `onStep` as it is taken and is not retained, so chunk memory does not grow with `chunkSec`.
 * A step whose context matches the previous one reuses the income the guard projected for it.
 *
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match An exact chunk uses the reference step grid.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match #e92627f Re-read the section: the chunk takes whole reference steps from nextBoundary on the summed clock, stops on until, the horizon, and the step budget, hands each step to onStep without holding it, and reuses the income the guard read.
 */
export function consumeExactChunk<N, U extends string, Vars>(args: Readonly<{
  /** The runner context for this tick, before `stepContext` sets `stepSec`. */
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;
  /** The dt the runner's `nextBoundary` already chose for the next step. */
  firstDt: number;
  stepSec: number;
  chunkSec: number;
  /** The runner's summed tick seconds so far. */
  elapsedSec: number;
  /** The runner's committed steps so far. */
  steps: number;
  durationSec?: number;
  maxSteps?: number;
  until?: (state: SimState<N, U, Vars>) => boolean;
  requested: "exact" | "approximation";
  strategy?: Strategy<N, U, Vars>;
  /** Receives each certified step in order. Nothing is called for a chunk refused at its first step. */
  onStep: (sample: ExactSample<N, U, Vars>) => void;
}>): ExactChunk<N, U, Vars> {
  if (!(args.chunkSec > 0) || !Number.isFinite(args.chunkSec)) {
    return { ok: false, reason: "chunkSec must be a finite number > 0" };
  }
  const { E } = args.ctx;
  let taken = 0;
  let carried: Readonly<{ dt: number; income: Money<N, U> }> | undefined;
  let cursor = args.state;
  let elapsedSec = args.elapsedSec;
  let steps = args.steps;
  let consumedSec = 0;
  let dt = args.firstDt;
  for (;;) {
    if (taken > 0) {
      const decision = nextBoundary({
        elapsedSec,
        steps,
        stepSec: args.stepSec,
        durationSec: args.durationSec,
        untilMet: args.until?.(cursor) ?? false,
        hasUntil: args.until !== undefined,
        maxSteps: args.maxSteps,
      });
      if (decision.kind !== "step") break;
      dt = decision.dt;
      if (consumedSec + dt > args.chunkSec) break;
    }
    const ctx = stepContext(args.ctx, dt);
    const certified = certifyAdvance(
      {
        ctx,
        model: args.model,
        state: cursor,
        dt,
        requested: args.requested,
        strategy: args.strategy,
      },
      // The previous step projected this state's income with the same context when dt is unchanged.
      carried?.dt === dt ? carried.income : undefined,
    );
    if (certified.reason !== null) {
      if (taken === 0) return { ok: false, reason: certified.reason };
      break;
    }
    const { next } = certified;
    const delta = appliedDelta(E, cursor.wallet.bucket, certified.income.amount, dt, ctx.tickPolicy.mode);
    args.onStep({
      t0: cursor.t,
      t1: next.t,
      dt,
      state: next,
      // The fixed-step reward test: an exactly positive applied amount.
      rewarded: exactAmountSign(E, delta) === 1,
    });
    carried = { dt, income: certified.nextIncome };
    taken += 1;
    cursor = next;
    elapsedSec += dt;
    steps += 1;
    consumedSec += dt;
  }
  return { ok: true, state: cursor, steps: taken };
}

export type AdvanceBenchRow = Readonly<{
  horizonSec: number;
  stepSec: number;
  fixedMs: number;
  exactMs: number;
  rssBytes: number;
  walletMatch: boolean;
}>;

/**
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-measured-bench The bench returns measured durations and rss.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-measured-bench #993ad19 Re-read the section: the function does not invent a speedup multiple.
 */
export function measureAdvanceRow(row: Omit<AdvanceBenchRow, "rssBytes"> & { rssBytes?: number }): AdvanceBenchRow {
  return {
    horizonSec: row.horizonSec,
    stepSec: row.stepSec,
    fixedMs: row.fixedMs,
    exactMs: row.exactMs,
    rssBytes: row.rssBytes ?? process.memoryUsage().rss,
    walletMatch: row.walletMatch,
  };
}
