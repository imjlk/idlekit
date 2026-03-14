import {
  analyzeGrowth,
  analyzeMilestones,
  simulateMonteCarlo,
  simulateSessionPattern,
  VisibilityTracker,
  type CompiledScenario,
  type GrowthReport,
  type MilestoneReport,
  type SessionPatternId,
  type SessionPatternSpec,
  type SessionRunResult,
  type SimState,
} from "@idlekit/core";

export type ExperienceSeries = "money" | "netWorth";

export type PerceivedProgressReport = Readonly<{
  series: ExperienceSeries;
  firstVisibleChangeSec?: number;
  visibleChangesPerMinute: number;
  maxNoRewardGapSec: number;
  avgPostPurchaseFeedbackSec?: number;
  p95PostPurchaseFeedbackSec?: number;
  visibleChangeCount: number;
  activeSeconds: number;
}>;

export type ExperienceSnapshot = Readonly<{
  endMoney: string;
  endNetWorth: string;
  endNetWorthLog10: number;
  growth: GrowthReport;
  milestones: MilestoneReport;
  perceived: PerceivedProgressReport;
  session: Readonly<{
    pattern: SessionPatternSpec;
    activeBlocks: number;
    totalActiveSec: number;
    totalOfflineSec: number;
  }>;
}>;

export type ExperienceNumericSummary = Readonly<{
  mean: number;
  quantiles: Readonly<Record<string, number>>;
}>;

export type ExperienceMonteCarloSummary = Readonly<{
  draws: number;
  seed: number;
  quantiles: readonly number[];
  endNetWorthLog10: ExperienceNumericSummary;
  visibleChangesPerMinute: ExperienceNumericSummary;
  maxNoRewardGapSec: ExperienceNumericSummary;
  firstVisibleChangeSec: ExperienceNumericSummary;
}>;

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}

function summarizeNumeric(values: number[], quantiles: readonly number[]): ExperienceNumericSummary {
  if (values.length === 0) {
    return {
      mean: 0,
      quantiles: Object.fromEntries(quantiles.map((q) => [`q${Math.round(q * 100)}`, 0])),
    };
  }

  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    quantiles: Object.fromEntries(quantiles.map((q) => [`q${Math.round(q * 100)}`, quantile(values, q)])),
  };
}

export function resolveSessionPatternSpec(args: {
  scenario: CompiledScenario<any, any, any>;
  sessionPatternId?: SessionPatternId;
  days?: number;
}): SessionPatternSpec {
  const scenarioPattern = args.scenario.design?.sessionPattern;
  return {
    id: args.sessionPatternId ?? scenarioPattern?.id ?? "always-on",
    days: Math.max(1, Math.floor(args.days ?? scenarioPattern?.days ?? 7)),
  };
}

export function resolveExperienceSeries(
  scenario: CompiledScenario<any, any, any>,
  requested?: ExperienceSeries,
): ExperienceSeries {
  return requested ?? scenario.analysis?.experience?.series ?? (scenario.model.netWorth ? "netWorth" : "money");
}

export function resolveExperienceDraws(scenario: CompiledScenario<any, any, any>, draws?: number): number {
  return Math.max(1, Math.floor(draws ?? scenario.analysis?.experience?.draws ?? 1));
}

export function resolveExperienceQuantiles(
  scenario: CompiledScenario<any, any, any>,
  quantiles?: readonly number[],
): readonly number[] {
  return quantiles ?? scenario.analysis?.experience?.quantiles ?? [0.1, 0.5, 0.9];
}

function moneyAtState<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  state: SimState<N, U, Vars>,
  series: ExperienceSeries,
) {
  return series === "netWorth" ? scenario.model.netWorth?.(scenario.ctx, state) ?? state.wallet.money : state.wallet.money;
}

function activeSegments<N, U extends string, Vars>(session: SessionRunResult<N, U, Vars>) {
  return session.segments.filter((segment): segment is Extract<typeof segment, { kind: "active" }> => segment.kind === "active");
}

export function analyzePerceivedProgression<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  session: SessionRunResult<N, U, Vars>;
  series: ExperienceSeries;
}): PerceivedProgressReport {
  const { scenario, session, series } = args;
  const tracker = new VisibilityTracker(scenario.ctx.E, {
    significantDigits: 3,
    trimTrailingZeros: true,
  });

  const startT = session.start.t;
  const changeTimes: number[] = [];
  const feedbackDelays: number[] = [];
  let totalActiveSec = 0;
  let maxNoRewardGapSec = 0;

  for (const segment of activeSegments(session)) {
    const trace = segment.run.trace ?? [segment.run.start, segment.run.end];
    if (trace.length === 0) continue;

    totalActiveSec += segment.durationSec;
    tracker.reset();

    const visibleTimestamps: number[] = [];
    for (const state of trace) {
      const change = tracker.observe(moneyAtState(scenario, state, series));
      if (change.changed) {
        visibleTimestamps.push(state.t);
        changeTimes.push(state.t);
      }
    }

    if (visibleTimestamps.length === 0) {
      maxNoRewardGapSec = Math.max(maxNoRewardGapSec, segment.durationSec);
    } else {
      maxNoRewardGapSec = Math.max(maxNoRewardGapSec, visibleTimestamps[0]! - segment.startT);
      for (let i = 1; i < visibleTimestamps.length; i += 1) {
        maxNoRewardGapSec = Math.max(maxNoRewardGapSec, visibleTimestamps[i]! - visibleTimestamps[i - 1]!);
      }
      maxNoRewardGapSec = Math.max(maxNoRewardGapSec, segment.endT - visibleTimestamps[visibleTimestamps.length - 1]!);
    }

    for (const action of segment.run.actionsLog ?? []) {
      const nextVisible = visibleTimestamps.find((t) => t >= action.t);
      const delay = nextVisible === undefined ? Math.max(0, segment.endT - action.t) : nextVisible - action.t;
      feedbackDelays.push(delay);
    }
  }

  const firstVisibleChangeSec = changeTimes.length > 0 ? Math.max(0, changeTimes[0]! - startT) : undefined;
  const visibleChangesPerMinute = totalActiveSec > 0 ? changeTimes.length / (totalActiveSec / 60) : 0;
  const avgPostPurchaseFeedbackSec =
    feedbackDelays.length > 0 ? feedbackDelays.reduce((sum, value) => sum + value, 0) / feedbackDelays.length : undefined;
  const p95PostPurchaseFeedbackSec = feedbackDelays.length > 0 ? quantile(feedbackDelays, 0.95) : undefined;

  return {
    series,
    firstVisibleChangeSec,
    visibleChangesPerMinute,
    maxNoRewardGapSec,
    avgPostPurchaseFeedbackSec,
    p95PostPurchaseFeedbackSec,
    visibleChangeCount: changeTimes.length,
    activeSeconds: totalActiveSec,
  };
}

export function snapshotFromSession<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  session: SessionRunResult<N, U, Vars>;
  series?: ExperienceSeries;
}): ExperienceSnapshot {
  const series = resolveExperienceSeries(args.scenario, args.series);
  const growth = analyzeGrowth({
    run: args.session.run,
    scenario: args.scenario,
    series,
    windowSec: args.scenario.analysis?.growth?.windowSec ?? 60,
  });
  const milestones = analyzeMilestones({ run: args.session.run });
  const perceived = analyzePerceivedProgression({
    scenario: args.scenario,
    session: args.session,
    series,
  });
  const endWorth = moneyAtState(args.scenario, args.session.end, "netWorth");

  return {
    endMoney: args.scenario.ctx.E.toString(args.session.end.wallet.money.amount),
    endNetWorth: args.scenario.ctx.E.toString(endWorth.amount),
    endNetWorthLog10: args.scenario.ctx.E.absLog10(endWorth.amount),
    growth,
    milestones,
    perceived,
    session: {
      pattern: args.session.pattern,
      activeBlocks: args.session.summary.activeBlocks,
      totalActiveSec: args.session.summary.totalActiveSec,
      totalOfflineSec: args.session.summary.totalOfflineSec,
    },
  };
}

export function collectExperienceSnapshot<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  sessionPattern?: SessionPatternSpec;
  seed?: number;
  series?: ExperienceSeries;
}): Readonly<{
  session: SessionRunResult<N, U, Vars>;
  snapshot: ExperienceSnapshot;
}> {
  const pattern = args.sessionPattern ?? resolveSessionPatternSpec({ scenario: args.scenario });
  const session = simulateSessionPattern({
    scenario: args.scenario,
    pattern,
    seed: args.seed,
  });

  return {
    session,
    snapshot: snapshotFromSession({
      scenario: args.scenario,
      session,
      series: args.series,
    }),
  };
}

export function summarizeExperienceMonteCarlo<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  sessionPattern: SessionPatternSpec;
  draws: number;
  seed: number;
  quantiles: readonly number[];
  series?: ExperienceSeries;
}): ExperienceMonteCarloSummary {
  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: args.sessionPattern,
    draws: args.draws,
    seed: args.seed,
    metrics: ({ scenario, session }) => {
      const snapshot = snapshotFromSession({
        scenario,
        session: session!,
        series: args.series,
      });
      return {
        endNetWorthLog10: snapshot.endNetWorthLog10,
        visibleChangesPerMinute: snapshot.perceived.visibleChangesPerMinute,
        maxNoRewardGapSec: snapshot.perceived.maxNoRewardGapSec,
        firstVisibleChangeSec: snapshot.perceived.firstVisibleChangeSec ?? session?.summary.totalActiveSec ?? 0,
      };
    },
  });

  const values = summary.results.map((entry) => entry.metrics);
  return {
    draws: summary.draws,
    seed: summary.seed,
    quantiles: args.quantiles,
    endNetWorthLog10: summarizeNumeric(values.map((x) => x.endNetWorthLog10), args.quantiles),
    visibleChangesPerMinute: summarizeNumeric(values.map((x) => x.visibleChangesPerMinute), args.quantiles),
    maxNoRewardGapSec: summarizeNumeric(values.map((x) => x.maxNoRewardGapSec), args.quantiles),
    firstVisibleChangeSec: summarizeNumeric(values.map((x) => x.firstVisibleChangeSec), args.quantiles),
  };
}

export function milestoneTime(report: MilestoneReport, key: string): number | undefined {
  return report.milestones.find((entry) => entry.key === key)?.firstSeenSec;
}

export function comparableExperienceMetric(args: {
  snapshot: ExperienceSnapshot;
  metric: "timeToMilestone" | "visibleChangesPerMinute" | "maxNoRewardGapSec";
  milestoneKey?: string;
  fallbackValue?: number;
}): number | undefined {
  const fallback = args.fallbackValue;
  switch (args.metric) {
    case "timeToMilestone":
      if (!args.milestoneKey) return args.snapshot.milestones.firstMilestoneSec ?? fallback;
      return milestoneTime(args.snapshot.milestones, args.milestoneKey) ?? fallback;
    case "visibleChangesPerMinute":
      return args.snapshot.perceived.visibleChangesPerMinute;
    case "maxNoRewardGapSec":
      return args.snapshot.perceived.maxNoRewardGapSec;
    default:
      return undefined;
  }
}

export function summarizeComparableExperienceMetric<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  sessionPattern: SessionPatternSpec;
  metric: "timeToMilestone" | "visibleChangesPerMinute" | "maxNoRewardGapSec";
  milestoneKey?: string;
  draws: number;
  seed: number;
  quantiles: readonly number[];
  series?: ExperienceSeries;
}): ExperienceNumericSummary {
  const fallbackValue = args.sessionPattern.days * 86400 + 1;
  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: args.sessionPattern,
    draws: args.draws,
    seed: args.seed,
    metrics: ({ scenario, session }) =>
      comparableExperienceMetric({
        snapshot: snapshotFromSession({
          scenario,
          session: session!,
          series: args.series,
        }),
        metric: args.metric,
        milestoneKey: args.milestoneKey,
        fallbackValue,
      }) ?? fallbackValue,
  });

  return summarizeNumeric(summary.results.map((entry) => entry.metrics), args.quantiles);
}

export function resolveSessionPatternId(value: string | undefined): SessionPatternId | undefined {
  if (
    value === "always-on" ||
    value === "short-bursts" ||
    value === "twice-daily" ||
    value === "offline-heavy" ||
    value === "weekend-marathon"
  ) {
    return value;
  }
  return undefined;
}

function formatMetric(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "n/a";
  return Number(value.toFixed(digits)).toString();
}

export function renderExperienceMarkdown(args: {
  scenarioPath: string;
  intent?: string;
  mode: "deterministic" | "monte-carlo";
  snapshot: ExperienceSnapshot;
  monteCarlo?: ExperienceMonteCarloSummary;
}): string {
  const { snapshot, monteCarlo } = args;
  const firstMilestone = snapshot.milestones.milestones[0];
  const milestoneLines =
    snapshot.milestones.milestones.length > 0
      ? snapshot.milestones.milestones
          .slice(0, 8)
          .map((entry) => `- \`${entry.key}\`: ${formatMetric(entry.firstSeenSec, 0)}s (${entry.source})`)
      : ["- none observed"];

  const lines = [
    "# Experience Report",
    "",
    `- Scenario: \`${args.scenarioPath}\``,
    `- Intent: ${args.intent ?? "unspecified"}`,
    `- Mode: ${args.mode}`,
    `- Session pattern: \`${snapshot.session.pattern.id}\` for ${snapshot.session.pattern.days} day(s)`,
    `- Active blocks: ${snapshot.session.activeBlocks}`,
    `- Active / offline: ${formatMetric(snapshot.session.totalActiveSec, 0)}s / ${formatMetric(snapshot.session.totalOfflineSec, 0)}s`,
    "",
    "## End State",
    "",
    `- End money: \`${snapshot.endMoney}\``,
    `- End net worth: \`${snapshot.endNetWorth}\``,
    `- End net worth (log10): ${formatMetric(snapshot.endNetWorthLog10, 3)}`,
    "",
    "## Perceived Progression",
    "",
    `- First visible change: ${formatMetric(snapshot.perceived.firstVisibleChangeSec, 0)}s`,
    `- Visible changes / minute: ${formatMetric(snapshot.perceived.visibleChangesPerMinute, 3)}`,
    `- Longest no-reward gap: ${formatMetric(snapshot.perceived.maxNoRewardGapSec, 0)}s`,
    `- Avg post-purchase feedback: ${formatMetric(snapshot.perceived.avgPostPurchaseFeedbackSec, 2)}s`,
    `- P95 post-purchase feedback: ${formatMetric(snapshot.perceived.p95PostPurchaseFeedbackSec, 2)}s`,
    "",
    "## Milestones",
    "",
    `- First milestone: ${firstMilestone ? `\`${firstMilestone.key}\` at ${formatMetric(firstMilestone.firstSeenSec, 0)}s` : "none"}`,
    ...milestoneLines,
    "",
    "## Growth",
    "",
    `- Series requested: \`${snapshot.growth.seriesRequested}\``,
    `- Value source: \`${snapshot.growth.valueSource}\``,
    `- Window: ${snapshot.growth.windowSec}s`,
    `- Segments: ${snapshot.growth.segments.length}`,
    `- Bottlenecks: ${snapshot.growth.bottlenecks.length}`,
  ];

  if (monteCarlo) {
    lines.push(
      "",
      "## Monte Carlo",
      "",
      `- Draws: ${monteCarlo.draws}`,
      `- Seed: ${monteCarlo.seed}`,
      `- Net worth log10 mean: ${formatMetric(monteCarlo.endNetWorthLog10.mean, 3)}`,
      `- Visible changes / minute mean: ${formatMetric(monteCarlo.visibleChangesPerMinute.mean, 3)}`,
      `- No-reward gap mean: ${formatMetric(monteCarlo.maxNoRewardGapSec.mean, 2)}s`,
    );
  }

  return `${lines.join("\n")}\n`;
}
