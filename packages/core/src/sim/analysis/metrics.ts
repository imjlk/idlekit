import type { SimContext, SimState } from "../types";
import {
  analysisAlgorithmVersion,
  type AnalysisCapabilityName,
  type AnalysisMethod,
  type AnalysisStatus,
  type CapabilityKnowledge,
  type GoalResultV1,
  type MetricDomain,
  type MetricKind,
  type MetricReadingV1,
  type MetricTimeAxis,
  type AnalysisArtifactV1,
  type ArtifactCoverage,
  classifyAmount,
  classifyFinite,
  unavailableReading,
} from "./contracts";

export type MetricExtract<N> =
  | Readonly<{ available: false; status: Exclude<AnalysisStatus, "ok">; reason?: string }>
  | Readonly<{ available: true; domain: "amount"; amount: N; unit: string }>
  | Readonly<{ available: true; domain: Exclude<MetricDomain, "amount">; value: number }>;

export type MetricDefinition<N, U extends string, Vars> = Readonly<{
  id: string;
  version: number;
  meaning: string;
  domain: MetricDomain;
  timeAxis: MetricTimeAxis;
  kind: MetricKind;
  extract: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => MetricExtract<N>;
}>;

type GoalObservation =
  | Readonly<{ status: "ok"; reached: boolean }>
  | Readonly<{ status: "unsupported" | "invalid" }>;

export type GoalDefinition<N, U extends string, Vars> = Readonly<{
  id: string;
  version: number;
  observation: "state" | "milestone-key" | "custom";
  timeResolution: "step";
  met: (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>) => boolean | undefined;
  assumptionsFor?: (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>) => readonly string[];
}>;

export type GoalEvaluation = Readonly<{
  goalId: string;
  goalVersion: number;
  reached?: boolean;
  status: "ok" | "unsupported" | "insufficient-data" | "invalid";
  assumptions: readonly string[];
}>;

const NET_WORTH_FALLBACK = "netWorth missing; wallet amount used";

// Attach the observer to the original predicate so met overrides keep working.
// A shared symbol also works when a plugin and its caller load separate core copies.
const GOAL_OBSERVATION = Symbol.for("@idlekit/core.goalObservation.v1");
type ObservedGoalPredicate<N, U extends string, Vars> = GoalDefinition<N, U, Vars>["met"] & {
  [GOAL_OBSERVATION]?: (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>) => GoalObservation;
};

export function walletMoneyMetric<N, U extends string, Vars>(): MetricDefinition<N, U, Vars> {
  return {
    id: "money",
    version: 1,
    meaning: "Current wallet amount",
    domain: "amount",
    timeAxis: "instant",
    kind: "stock",
    extract(_ctx, state) {
      return {
        available: true,
        domain: "amount",
        amount: state.wallet.money.amount,
        unit: state.wallet.money.unit.code,
      };
    },
  };
}

export function netWorthMetric<N, U extends string, Vars>(
  read: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => { amount: N; unit: string } | undefined,
): MetricDefinition<N, U, Vars> {
  return {
    id: "netWorth",
    version: 1,
    meaning: "Current net worth amount",
    domain: "amount",
    timeAxis: "instant",
    kind: "stock",
    extract(ctx, state) {
      const worth = read(ctx, state);
      if (!worth) return { available: false, status: "unsupported", reason: "netWorth is not provided" };
      return { available: true, domain: "amount", amount: worth.amount, unit: worth.unit };
    },
  };
}

export function prestigePointsMetric<N, U extends string, Vars>(): MetricDefinition<N, U, Vars> {
  return {
    id: "prestige.points",
    version: 1,
    meaning: "Current prestige points",
    domain: "amount",
    timeAxis: "instant",
    kind: "stock",
    extract(_ctx, state) {
      return {
        available: true,
        domain: "amount",
        amount: state.prestige.points,
        unit: "prestige.points",
      };
    },
  };
}

export function finiteValueMetric<N, U extends string, Vars>(args: {
  id: string;
  version?: number;
  meaning: string;
  domain: Exclude<MetricDomain, "amount">;
  kind?: MetricKind;
  timeAxis?: MetricTimeAxis;
  read: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => number | undefined;
}): MetricDefinition<N, U, Vars> {
  return {
    id: args.id,
    version: args.version ?? 1,
    meaning: args.meaning,
    domain: args.domain,
    timeAxis: args.timeAxis ?? "instant",
    kind: args.kind ?? "stock",
    extract(ctx, state) {
      const value = args.read(ctx, state);
      if (value === undefined) return { available: false, status: "unsupported", reason: "value is not provided" };
      return { available: true, domain: args.domain, value };
    },
  };
}

export function readMetric<N, U extends string, Vars>(
  metric: MetricDefinition<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  method?: AnalysisMethod,
): MetricReadingV1 {
  const extracted = metric.extract(ctx, state);
  const base = {
    metricId: metric.id,
    metricVersion: metric.version,
    meaning: metric.meaning,
    metricKind: metric.kind,
    timeAxis: metric.timeAxis,
    domain: metric.domain,
  };
  if (!extracted.available) {
    return unavailableReading({
      ...base,
      status: extracted.status,
      ...(extracted.reason !== undefined ? { reason: extracted.reason } : {}),
    });
  }
  // A registered extractor is typed apart from its definition. A mismatch is reported, not mixed into one reading.
  if (extracted.domain !== metric.domain) {
    return unavailableReading({
      ...base,
      status: "invalid",
      reason: `extractor returned domain ${extracted.domain}; the metric declares ${metric.domain}`,
    });
  }
  const classified = extracted.domain === "amount"
    ? classifyAmount(ctx.E, extracted.amount, extracted.unit)
    : classifyFinite(extracted.value);
  const reading = method === undefined ? "observed" : "estimated";
  return {
    ...base,
    reading: classified.status === "ok" ? reading : "unavailable",
    ...classified,
    ...(method !== undefined && classified.status === "ok" ? { method } : {}),
  };
}

function amountGoalObservation<N, U extends string, Vars>(
  target: string,
  read: (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>) => N | undefined,
): Pick<GoalDefinition<N, U, Vars>, "met"> {
  const observe = (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>): GoalObservation => {
    // Some decimal engines saturate an Infinity spelling to a finite sentinel.
    if (/^[+-]?(?:nan|infinity)$/i.test(target.trim())) return { status: "invalid" };
    const threshold = ctx.E.from(target);
    if (!ctx.E.isFinite(threshold)) return { status: "invalid" };
    const amount = read(state, ctx);
    if (amount === undefined) return { status: "unsupported" };
    if (!ctx.E.isFinite(amount)) return { status: "invalid" };
    return { status: "ok", reached: ctx.E.cmp(amount, threshold) >= 0 };
  };
  const met = (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>): boolean | undefined => {
    const result = observe(state, ctx);
    return result.status === "ok" ? result.reached : undefined;
  };
  Object.defineProperty(met, GOAL_OBSERVATION, { value: observe });
  return { met };
}

export function moneyAtLeast<N, U extends string, Vars>(target: string): GoalDefinition<N, U, Vars> {
  return {
    id: "money.atLeast",
    version: 1,
    observation: "state",
    timeResolution: "step",
    ...amountGoalObservation<N, U, Vars>(target, (state) => state.wallet.money.amount),
  };
}

export function netWorthAtLeast<N, U extends string, Vars>(args: {
  target: string;
  netWorth: (state: SimState<N, U, Vars>, ctx: SimContext<N, U, Vars>) => N | undefined;
  fallbackToWallet?: boolean;
}): GoalDefinition<N, U, Vars> {
  return {
    id: "netWorth.atLeast",
    version: 1,
    observation: "state",
    timeResolution: "step",
    ...amountGoalObservation<N, U, Vars>(args.target, (state, ctx) => {
      const worth = args.netWorth(state, ctx);
      return worth ?? (args.fallbackToWallet ? state.wallet.money.amount : undefined);
    }),
    assumptionsFor(state, ctx) {
      if (!args.fallbackToWallet || args.netWorth(state, ctx) !== undefined) return [];
      return [NET_WORTH_FALLBACK];
    },
  };
}

export function prestigePointsAtLeast<N, U extends string, Vars>(target: string): GoalDefinition<N, U, Vars> {
  return {
    id: "prestige.points.atLeast",
    version: 1,
    observation: "state",
    timeResolution: "step",
    ...amountGoalObservation<N, U, Vars>(target, (state) => state.prestige.points),
  };
}

export function milestoneReached<N, U extends string, Vars>(args: {
  key: string;
  seen: readonly string[];
}): GoalDefinition<N, U, Vars> {
  return {
    id: `milestone.${args.key}`,
    version: 1,
    observation: "milestone-key",
    timeResolution: "step",
    met() {
      return args.seen.includes(args.key);
    },
  };
}

export function defineGoal<N, U extends string, Vars>(goal: GoalDefinition<N, U, Vars>): GoalDefinition<N, U, Vars> {
  return goal;
}

export function evaluateGoal<N, U extends string, Vars>(
  goal: GoalDefinition<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): GoalEvaluation {
  let observation: GoalObservation;
  const observe = (goal.met as ObservedGoalPredicate<N, U, Vars>)[GOAL_OBSERVATION];
  if (observe) {
    observation = observe(state, ctx);
  } else {
    const reached = goal.met(state, ctx);
    observation = reached === undefined ? { status: "unsupported" } : { status: "ok", reached };
  }
  if (observation.status !== "ok") {
    return {
      goalId: goal.id,
      goalVersion: goal.version,
      status: observation.status,
      assumptions: [],
    };
  }
  return {
    goalId: goal.id,
    goalVersion: goal.version,
    reached: observation.reached,
    status: "ok",
    assumptions: goal.assumptionsFor?.(state, ctx) ?? [],
  };
}

function withMethod(evaluation: GoalEvaluation, method: AnalysisMethod): GoalResultV1 {
  if (evaluation.status !== "ok") {
    return {
      goalId: evaluation.goalId,
      goalVersion: evaluation.goalVersion,
      status: evaluation.status,
      assumptions: evaluation.assumptions,
    };
  }
  return {
    goalId: evaluation.goalId,
    goalVersion: evaluation.goalVersion,
    status: "ok",
    method,
    ...(evaluation.reached !== undefined ? { reached: evaluation.reached } : {}),
    assumptions: evaluation.assumptions,
  };
}

export function evaluateGoalForEta<N, U extends string, Vars>(
  goal: GoalDefinition<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): GoalResultV1 {
  return withMethod(evaluateGoal(goal, state, ctx), "fixed-step");
}

export function evaluateGoalForExperiment<N, U extends string, Vars>(
  goal: GoalDefinition<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): GoalResultV1 {
  return withMethod(evaluateGoal(goal, state, ctx), "monte-carlo");
}

export function evaluateGoalForCheck<N, U extends string, Vars>(
  goal: GoalDefinition<N, U, Vars>,
  state: SimState<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
): GoalResultV1 {
  return withMethod(evaluateGoal(goal, state, ctx), "exact");
}

export function capabilityKnowledge(
  declared: Partial<Record<AnalysisCapabilityName, "statically-known" | "unsupported">> | undefined,
  name: AnalysisCapabilityName,
): CapabilityKnowledge {
  if (declared === undefined) return "unknown";
  if (declared[name] === "statically-known") return "statically-known";
  return "unsupported";
}

export function unsupportedCapabilityResult(name: AnalysisCapabilityName): Readonly<{
  capability: AnalysisCapabilityName;
  knowledge: "unsupported";
  status: "unsupported";
}> {
  return { capability: name, knowledge: "unsupported", status: "unsupported" };
}

export type AnalysisArtifactDraft = Readonly<{
  algorithmVersion?: string;
  assumptions?: readonly string[];
  warnings?: readonly string[];
  observationCoverage?: ArtifactCoverage;
  horizon?: AnalysisArtifactV1["horizon"];
  sampleCount?: number;
  effectiveRunHash?: string;
  metrics?: readonly MetricReadingV1[];
  goals?: readonly GoalResultV1[];
  capabilities?: AnalysisArtifactV1["capabilities"];
}>;

export function buildAnalysisArtifact(draft: AnalysisArtifactDraft = {}): AnalysisArtifactV1 {
  const capabilities = draft.capabilities ?? {
    metrics: "unknown",
    goals: "unknown",
    reset: "unknown",
    flow: "unknown",
    advance: "unknown",
  };
  return {
    schemaVersion: 1,
    algorithmVersion: draft.algorithmVersion ?? analysisAlgorithmVersion(),
    assumptions: draft.assumptions ?? [],
    warnings: draft.warnings ?? [],
    observationCoverage: draft.observationCoverage ?? "unknown",
    ...(draft.horizon !== undefined ? { horizon: draft.horizon } : {}),
    ...(draft.sampleCount !== undefined ? { sampleCount: draft.sampleCount } : {}),
    ...(draft.effectiveRunHash !== undefined ? { effectiveRunHash: draft.effectiveRunHash } : {}),
    metrics: draft.metrics ?? [],
    goals: draft.goals ?? [],
    capabilities,
  };
}
