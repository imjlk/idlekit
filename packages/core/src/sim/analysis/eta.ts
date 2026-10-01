import type { Engine } from "../../engine/types";
import { parseMoney } from "../../notation/parseMoney";
import { runScenario } from "../simulator";
import { assertHorizonReached, runElapsedSec, type CompiledScenario, type RunResult, type SimState } from "../types";
import type { AnalysisMethod, AnalysisStatus } from "./contracts";
import {
  evaluateGoal,
  moneyAtLeast,
  netWorthAtLeast,
  walletMoneyMetric,
  type GoalDefinition,
} from "./metrics";
import typia, { type IValidation } from "typia";

/**
 * ETA estimate v1.
 * Legacy `ETAResult.seconds` stays a number. This object carries status.
 * DX-02 may wrap these functions. It should not grow a second ETA engine.
 */

const ETA_SUFFIX = { kind: "alphaInfinite", minLen: 2 } as const;
const ETA_ALGORITHM_VERSION = "eta-estimate-v1" as const;
const ETA_SCHEMA_ID = "https://idlekit.dev/schemas/eta.estimate.v1.schema.json" as const;

/**
 * @evidence docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-engine-ratio The time ratio is divided inside the Engine before any seconds number.
 * @evidenceReview docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-engine-ratio #fe46221 Re-read the section: 1e402 over 1e400 is 100 seconds, not a narrowed division.
 */
export const etaEngineRatio = "engine-divn-before-number" as const;

/**
 * @evidence docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-exact-local Exact needs a constant derivative and no purchase, reset, evolve, or policy boundary.
 * @evidenceReview docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-exact-local #4433726 Re-read the section: incomeKind constant is not exact, and net worth is not money income.
 */
export const etaExactOrLocal = "exact-or-analytic-local" as const;

/**
 * @evidence docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-censored-observation A missed horizon is censored. Fixed-step time is the first observation.
 * @evidenceReview docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-censored-observation #a644d35 Re-read the section: seconds is null, the legacy field stays the horizon, and there is no unreachable claim.
 */
export const etaCensoredObservation = "censored-fixed-step" as const;

export function etaEstimateSchemaId(): typeof ETA_SCHEMA_ID {
  return ETA_SCHEMA_ID;
}

export function etaEstimateAlgorithmVersion(): typeof ETA_ALGORITHM_VERSION {
  return ETA_ALGORITHM_VERSION;
}

export type ETATarget = Readonly<
  | { kind: "money"; value: string }
  | { kind: "netWorth"; value: string }
>;

export type EtaEstimateV1 = Readonly<{
  schemaVersion: 1;
  algorithmVersion: typeof ETA_ALGORITHM_VERSION;
  goalId: string;
  goalVersion: number;
  metricId: string;
  meaning: string;
  timeAxis: "interval";
  status: AnalysisStatus;
  method?: AnalysisMethod;
  seconds: number | null;
  secondsDecimal?: string;
  observationResolutionSec?: number;
  bracket?: Readonly<{ lowerSec: number; upperSec: number }>;
  assumptions: readonly string[];
  warnings: readonly string[];
  horizonSec?: number;
  compare?: Readonly<{
    localMethod: AnalysisMethod | null;
    fixedStepMethod: "fixed-step";
    localSec: number | null;
    fixedStepSec: number | null;
    diffSec: number | null;
  }>;
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let etaEstimateValidator: ((input: unknown) => IValidation<EtaEstimateV1>) | undefined;

export const validateEtaEstimate = (input: unknown): IValidation<EtaEstimateV1> =>
  (etaEstimateValidator ??= typia.createValidate<EtaEstimateV1>())(input);

function buildEtaEstimateJsonSchema() {
  return typia.json.schema<EtaEstimateV1, "3.1">();
}

let etaEstimateJsonSchemaUnit: ReturnType<typeof buildEtaEstimateJsonSchema> | undefined;

export function etaEstimateJsonSchema(): ReturnType<typeof buildEtaEstimateJsonSchema> {
  etaEstimateJsonSchemaUnit ??= buildEtaEstimateJsonSchema();
  return etaEstimateJsonSchemaUnit;
}

export type ETAResult = Readonly<{
  reached: boolean;
  seconds: number;
  mode: "simulate" | "analytic";
  confidence?: "high" | "medium" | "low";
  assumptions?: string[];
  compare?: Readonly<{
    simulateSec?: number;
    analyticSec?: number;
    diffSec?: number;
    diffPct?: number;
  }>;
  run?: RunResult<any, any, any>;
  estimate: EtaEstimateV1;
}>;

export type EtaRatioResult = Readonly<{
  status: "ok" | "invalid" | "unsupported" | "insufficient-data";
  seconds: number | null;
  secondsDecimal?: string;
}>;

type GoalBinding<N, U extends string, Vars> = Readonly<{
  goal: GoalDefinition<N, U, Vars>;
  threshold: N;
  metricId: string;
  meaning: string;
}>;

function finiteSeconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Divide the gap by the rate in the Engine, then narrow.
 * `toNumber` sees only that ratio, and only when it is a finite seconds count.
 */
export function etaSecondsFromEngineRatio<N>(
  E: Engine<N>,
  target: N,
  current: N,
  rate: N,
  provenConstant: boolean,
): EtaRatioResult {
  if (!E.isFinite(target) || !E.isFinite(current) || !E.isFinite(rate)) {
    return { status: "invalid", seconds: null };
  }
  if (E.cmp(rate, E.zero()) <= 0) {
    return {
      status: provenConstant ? "unsupported" : "insufficient-data",
      seconds: null,
    };
  }
  const ratio = E.divN(E.sub(target, current), rate);
  if (!E.isFinite(ratio)) return { status: "invalid", seconds: null, secondsDecimal: E.toString(ratio) };
  const magnitude = E.absLog10(ratio);
  if (Number.isFinite(magnitude) && magnitude > 308) {
    return { status: "invalid", seconds: null, secondsDecimal: E.toString(ratio) };
  }
  const seconds = finiteSeconds(E.toNumber(ratio));
  if (seconds === undefined) {
    return { status: "invalid", seconds: null, secondsDecimal: E.toString(ratio) };
  }
  return { status: "ok", seconds };
}

export function parseEtaAmount<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  value: string,
): N {
  return parseMoney(scenario.ctx.E, value, {
    unit: scenario.ctx.unit,
    suffix: ETA_SUFFIX,
  }).amount;
}

export function etaGoalForTarget<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  target: ETATarget,
): GoalBinding<N, U, Vars> {
  const threshold = parseEtaAmount(scenario, target.value);
  const wire = scenario.ctx.E.toString(threshold);
  if (target.kind === "money") {
    const metric = walletMoneyMetric<N, U, Vars>();
    return { goal: moneyAtLeast(wire), threshold, metricId: metric.id, meaning: metric.meaning };
  }
  return {
    goal: netWorthAtLeast({
      target: wire,
      netWorth: (state, ctx) => scenario.model.netWorth?.(ctx, state)?.amount,
      fallbackToWallet: scenario.model.netWorth === undefined,
    }),
    threshold,
    metricId: "netWorth",
    meaning: "Current net worth amount",
  };
}

function exactBlocks<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>): string[] {
  const blocks: string[] = [];
  const hint = scenario.model.analytic?.(scenario.ctx, scenario.initial);
  if (hint?.incomeKind !== "constant") blocks.push("income derivative is not confirmed constant");
  if (scenario.model.actions(scenario.ctx, scenario.initial).length > 0) {
    blocks.push("an action can change income");
  }
  if (scenario.model.evolve) blocks.push("evolve can change the state inside a step");
  if (scenario.model.prestige) blocks.push("prestige reset can make the metric non-monotonic");
  if (scenario.strategy) blocks.push("a strategy can apply a decision");
  if (scenario.constraints) blocks.push("a policy constraint can change the schedule");
  return blocks;
}

function baseEstimate(
  binding: GoalBinding<any, any, any>,
  status: AnalysisStatus,
  extra: Partial<EtaEstimateV1> = {},
): EtaEstimateV1 {
  return {
    schemaVersion: 1,
    algorithmVersion: ETA_ALGORITHM_VERSION,
    goalId: binding.goal.id,
    goalVersion: binding.goal.version,
    metricId: binding.metricId,
    meaning: binding.meaning,
    timeAxis: "interval",
    status,
    seconds: extra.seconds ?? null,
    assumptions: extra.assumptions ?? [],
    warnings: extra.warnings ?? [],
    ...(extra.method !== undefined ? { method: extra.method } : {}),
    ...(extra.secondsDecimal !== undefined ? { secondsDecimal: extra.secondsDecimal } : {}),
    ...(extra.observationResolutionSec !== undefined
      ? { observationResolutionSec: extra.observationResolutionSec }
      : {}),
    ...(extra.bracket !== undefined ? { bracket: extra.bracket } : {}),
    ...(extra.horizonSec !== undefined ? { horizonSec: extra.horizonSec } : {}),
    ...(extra.compare !== undefined ? { compare: extra.compare } : {}),
  };
}

function confidenceFor(estimate: EtaEstimateV1): "high" | "medium" | "low" {
  if (estimate.status !== "ok") return "low";
  if (estimate.method === "exact") return "high";
  return "medium";
}

function legacyInfinity(): number {
  return Number.POSITIVE_INFINITY;
}

function analyticEstimate<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  target: ETATarget,
): { reached: boolean; seconds: number; estimate: EtaEstimateV1 } {
  const { E } = scenario.ctx;
  const binding = etaGoalForTarget(scenario, target);
  const blocks = exactBlocks(scenario);
  const proven = blocks.length === 0 && target.kind === "money";
  const evaluation = evaluateGoal(binding.goal, scenario.initial, scenario.ctx);
  // cmp reads NaN as reached. A non-finite wallet or target falls through to the engine ratio, which is invalid.
  const already =
    evaluation.reached === true &&
    E.isFinite(binding.threshold) &&
    E.isFinite(scenario.initial.wallet.money.amount);

  if (target.kind === "netWorth" && scenario.model.netWorth) {
    const current = scenario.model.netWorth(scenario.ctx, scenario.initial).amount;
    // cmp reads NaN as already reached, so a non-finite side is checked first.
    if (E.isFinite(current) && E.isFinite(binding.threshold) && E.cmp(current, binding.threshold) >= 0) {
      return {
        reached: true,
        seconds: 0,
        estimate: baseEstimate(binding, "ok", {
          seconds: 0,
          assumptions: [
            "target already reached at t=0",
            "net worth was read directly; money income is not its derivative",
          ],
        }),
      };
    }
    const rate = scenario.model.income(scenario.ctx, scenario.initial).amount;
    const local = etaSecondsFromEngineRatio(E, binding.threshold, current, rate, false);
    return {
      reached: local.seconds !== null,
      seconds: local.seconds ?? legacyInfinity(),
      estimate: baseEstimate(binding, "unsupported", {
        assumptions: [
          "unsupported-local",
          "net worth has its own value, so money income is not its derivative",
          "legacy seconds keeps the old initial-income ratio and is not a net worth result",
          ...blocks,
        ],
        ...(local.secondsDecimal !== undefined ? { secondsDecimal: local.secondsDecimal } : {}),
      }),
    };
  }

  if (target.kind === "netWorth") {
    const wallet = scenario.initial.wallet.money.amount;
    const local = already
      ? { status: "ok" as const, seconds: 0 }
      : etaSecondsFromEngineRatio(E, binding.threshold, wallet, scenario.model.income(scenario.ctx, scenario.initial).amount, false);
    return {
      reached: already,
      seconds: local.seconds ?? legacyInfinity(),
      estimate: baseEstimate(binding, "unsupported", {
        assumptions: [
          "unsupported-local",
          "netWorth is absent; the legacy seconds field reuses wallet money and is not a net worth derivative",
          ...(evaluation.assumptions ?? []),
        ],
      }),
    };
  }

  const current = scenario.initial.wallet.money.amount;
  if (already) {
    const method: AnalysisMethod = proven ? "exact" : "analytic-local";
    return {
      reached: true,
      seconds: 0,
      estimate: baseEstimate(binding, "ok", {
        method,
        seconds: 0,
        assumptions: ["target already reached at t=0", ...blocks],
      }),
    };
  }

  const rate = scenario.model.income(scenario.ctx, scenario.initial).amount;
  const ratio = etaSecondsFromEngineRatio(E, binding.threshold, current, rate, proven);
  if (ratio.status !== "ok" || ratio.seconds === null) {
    const assumptions = [
      ratio.status === "unsupported"
        ? "constant non-positive income does not reach a higher target; this is not labeled unreachable"
        : ratio.status === "insufficient-data"
          ? "the local rate is not positive; that is not proof the target stays out of reach"
          : "the engine ratio is not a finite seconds count",
      ...blocks,
    ];
    return {
      reached: false,
      seconds: legacyInfinity(),
      estimate: baseEstimate(binding, ratio.status, {
        assumptions,
        ...(ratio.secondsDecimal !== undefined ? { secondsDecimal: ratio.secondsDecimal } : {}),
      }),
    };
  }

  const method: AnalysisMethod = proven ? "exact" : "analytic-local";
  return {
    reached: true,
    seconds: ratio.seconds,
    estimate: baseEstimate(binding, "ok", {
      method,
      seconds: ratio.seconds,
      assumptions: [
        method === "exact"
          ? "constant money derivative with no purchase, reset, evolve, or policy boundary"
          : "analytic-local estimate from the initial rate only",
        ...blocks,
      ],
    }),
  };
}

function bracketFor(
  continuous: number | null,
  observed: number,
): EtaEstimateV1["bracket"] | undefined {
  if (continuous === null || !Number.isFinite(observed)) return undefined;
  const lower = Math.min(continuous, observed);
  const upper = Math.max(continuous, observed);
  return { lowerSec: lower, upperSec: upper };
}

export function etaSimulate<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  target: ETATarget;
  maxDurationSec: number;
  includeRun?: boolean;
}): ETAResult {
  const binding = etaGoalForTarget(args.scenario, args.target);
  const until = (state: SimState<N, U, Vars>) => binding.goal.met(state, args.scenario.ctx) === true;
  const scenario: CompiledScenario<N, U, Vars> = {
    ...args.scenario,
    run: {
      ...args.scenario.run,
      durationSec: args.maxDurationSec,
      trace: undefined,
      until,
    },
  };
  const run = runScenario(scenario);
  // A budget stop is neither the target nor maxDurationSec.
  assertHorizonReached(run, "etaSimulate");
  const reached = evaluateGoal(binding.goal, run.end, scenario.ctx).reached === true;
  const observed = reached ? runElapsedSec(run) : args.maxDurationSec;
  const resolution = args.scenario.run.stepSec;
  const blocks = exactBlocks(args.scenario);
  const monotonic = blocks.length === 0 && args.target.kind === "money";
  const continuousSeconds = monotonic ? analyticEstimate(args.scenario, args.target).estimate.seconds : null;
  const assumptions = [
    "fixed-step first observation, not a continuous crossing",
    ...(reached ? [] : ["horizon ended before the goal was observed"]),
    ...blocks,
  ];
  const bracket = reached && continuousSeconds !== null ? bracketFor(continuousSeconds, observed) : undefined;

  const estimate: EtaEstimateV1 = !reached
    ? baseEstimate(binding, "censored", {
        horizonSec: args.maxDurationSec,
        observationResolutionSec: resolution,
        assumptions,
      })
    : baseEstimate(binding, "ok", {
        method: "fixed-step",
        seconds: observed,
        observationResolutionSec: resolution,
        ...(bracket !== undefined ? { bracket } : {}),
        assumptions: bracket
          ? assumptions
          : [...assumptions, "no reach bracket; a hidden crossing is not ruled out"],
      });

  return {
    reached,
    seconds: observed,
    mode: "simulate",
    confidence: confidenceFor(estimate),
    assumptions: ["Direct simulation over maxDurationSec", ...assumptions],
    run: args.includeRun ? run : undefined,
    estimate,
  };
}

export function etaAnalytic<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  target: ETATarget;
  fallback?: { maxDurationSec: number };
}): ETAResult {
  const local = analyticEstimate(args.scenario, args.target);
  let estimate = local.estimate;
  if (args.fallback) {
    const stepped = etaSimulate({
      scenario: args.scenario,
      target: args.target,
      maxDurationSec: args.fallback.maxDurationSec,
    });
    const localSec = local.estimate.status === "ok" ? local.estimate.seconds : null;
    const fixedStepSec = stepped.estimate.status === "ok" ? stepped.estimate.seconds : null;
    estimate = {
      ...local.estimate,
      compare: {
        localMethod: local.estimate.method ?? null,
        fixedStepMethod: "fixed-step",
        localSec,
        fixedStepSec,
        diffSec: localSec !== null && fixedStepSec !== null ? fixedStepSec - localSec : null,
      },
    };
  }
  return {
    reached: local.reached,
    seconds: local.seconds,
    mode: "analytic",
    confidence: confidenceFor(estimate),
    assumptions: [...estimate.assumptions],
    estimate,
  };
}

export function validateEtaEstimateSemantics(estimate: EtaEstimateV1): readonly string[] {
  const issues: string[] = [];
  if (estimate.status === "censored" && estimate.seconds !== null) {
    issues.push("censored estimate carries seconds");
  }
  if (estimate.status === "ok" && (estimate.seconds === null || !Number.isFinite(estimate.seconds))) {
    issues.push("ok estimate has no finite seconds");
  }
  if (estimate.method === "exact" && estimate.status !== "ok") issues.push("exact method is not ok");
  if (estimate.bracket && estimate.status !== "ok") issues.push("bracket on a non-ok estimate");
  if (JSON.stringify(estimate).includes("unreachable")) issues.push("estimate says unreachable");
  return issues;
}
