import {
  analyzeGrowth,
  analyzeMilestones,
  simulateMonteCarlo,
  simulateSessionPattern,
  VisibilityTracker,
  type CompiledScenario,
  type GrowthReport,
  type MilestoneReport,
  type RunBindOptions,
  type RunFactoryDeps,
  type SessionPatternId,
  type SessionPatternSpec,
  type SessionRunResult,
  type SessionSegment,
  type SimContext,
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
  /** Recorded model state, not a counterfactual estimate of prestige's benefit. */
  endPrestige?: Readonly<{ count: number; points: string; multiplier: string }>;
  growth: GrowthReport;
  milestones: MilestoneReport;
  perceived: PerceivedProgressReport;
  session: Readonly<{
    pattern: SessionPatternSpec;
    activeBlocks: number;
    totalActiveSec: number;
    totalOfflineSec: number;
    elapsedSec: number;
    horizonSec: number;
    activeSec: number;
    offlineElapsedSec: number;
    offlineCreditedSec: number;
    lostRewardSec: number;
    rewardSec: number;
    /** Active blocks cut short by `run.maxSteps`. */
    budgetStops: number;
    stopReason: SessionRunResult<unknown, string, unknown>["summary"]["stop"]["reason"];
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
  scenario: Pick<CompiledScenario<any, any, any>, "design">;
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

export function resolveExperienceDraws(scenario: Pick<CompiledScenario<any, any, any>, "analysis">, draws?: number): number {
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

// A model that reads clocks saw them only on its segment's context. Read its net worth there too.
function segmentScenario<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  segment: SessionSegment<N, U, Vars> | undefined,
): CompiledScenario<N, U, Vars> {
  return segment?.clocks ? { ...scenario, ctx: { ...scenario.ctx, clocks: segment.clocks } } : scenario;
}

// The session trace joins every active block. Each point keeps the context of the block that traced it.
function growthScenario<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  session: SessionRunResult<N, U, Vars>,
): CompiledScenario<N, U, Vars> {
  const model = scenario.model;
  const netWorth = model.netWorth;
  if (!netWorth || !session.segments.some((segment) => segment.clocks)) return scenario;
  const ctxOf = new Map<SimState<N, U, Vars>, SimContext<N, U, Vars>>();
  for (const segment of activeSegments(session)) {
    const ctx = segmentScenario(scenario, segment).ctx;
    for (const state of segment.run.trace ?? []) if (!ctxOf.has(state)) ctxOf.set(state, ctx);
  }
  ctxOf.set(session.start, segmentScenario(scenario, session.segments[0]).ctx);
  ctxOf.set(session.end, segmentScenario(scenario, session.segments.at(-1)).ctx);
  return {
    ...scenario,
    model: Object.assign(Object.create(model) as typeof model, {
      netWorth: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) =>
        netWorth.call(model, ctxOf.get(state) ?? ctx, state),
    }),
  };
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

  // Active segments only. `durationSec` and `state.t` are reward time, not wall elapsed.
  for (const segment of activeSegments(session)) {
    // Reads every active step. A session trace budget cuts each block's trace and action rows,
    // and what is left would read as quiet play.
    const droppedPoints = segment.run.traceLog?.dropped ?? 0;
    const droppedActions = segment.run.actionsLogMeta?.dropped ?? 0;
    if (droppedPoints > 0 || droppedActions > 0) {
      throw new Error(
        `perceived progression needs every active step; a session block dropped ${droppedPoints} trace points and ${droppedActions} action rows under trace.maxPoints or trace.maxActions`,
      );
    }
    const trace = segment.run.trace ?? [segment.run.start, segment.run.end];
    if (trace.length === 0) continue;
    const view = segmentScenario(scenario, segment);

    totalActiveSec += segment.durationSec;
    tracker.reset();

    const visibleTimestamps: number[] = [];
    for (const state of trace) {
      const change = tracker.observe(moneyAtState(view, state, series));
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
  // Growth reads the merged session trace. A budget can keep every block whole and still evict
  // the merged trace's early points; slopes over the retained tail would read as the whole session.
  const droppedPoints = args.session.run.traceLog?.dropped ?? 0;
  if (droppedPoints > 0) {
    throw new Error(
      `session growth needs the whole session trace; the session dropped ${droppedPoints} trace points under trace.maxPoints`,
    );
  }
  const growth = analyzeGrowth({
    run: args.session.run,
    scenario: growthScenario(args.scenario, args.session),
    series,
    windowSec: args.scenario.analysis?.growth?.windowSec ?? 60,
  });
  const milestones = analyzeMilestones({ run: args.session.run });
  const perceived = analyzePerceivedProgression({
    scenario: args.scenario,
    session: args.session,
    series,
  });
  const endWorth = moneyAtState(segmentScenario(args.scenario, args.session.segments.at(-1)), args.session.end, "netWorth");

  return {
    endMoney: args.scenario.ctx.E.toString(args.session.end.wallet.money.amount),
    endNetWorth: args.scenario.ctx.E.toString(endWorth.amount),
    endNetWorthLog10: args.scenario.ctx.E.absLog10(endWorth.amount),
    endPrestige: {
      count: args.session.end.prestige.count,
      points: args.scenario.ctx.E.toString(args.session.end.prestige.points),
      multiplier: args.scenario.ctx.E.toString(args.session.end.prestige.multiplier),
    },
    growth,
    milestones,
    perceived,
    session: {
      pattern: args.session.pattern,
      activeBlocks: args.session.summary.activeBlocks,
      totalActiveSec: args.session.summary.totalActiveSec,
      totalOfflineSec: args.session.summary.totalOfflineSec,
      elapsedSec: args.session.summary.elapsedSec,
      horizonSec: args.session.summary.horizonSec,
      activeSec: args.session.summary.activeSec,
      offlineElapsedSec: args.session.summary.offlineElapsedSec,
      offlineCreditedSec: args.session.summary.offlineCreditedSec,
      lostRewardSec: args.session.summary.lostRewardSec,
      rewardSec: args.session.summary.rewardSec,
      budgetStops: args.session.summary.budgetStops,
      stopReason: args.session.summary.stop.reason,
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
  /** Factories for a new model and strategy per draw. Without them a closure is shared across draws. */
  registries?: RunFactoryDeps;
  isolation?: RunBindOptions;
}): ExperienceMonteCarloSummary {
  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: args.sessionPattern,
    draws: args.draws,
    seed: args.seed,
    registries: args.registries,
    isolation: args.isolation,
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

/**
 * Seconds to `key`, or undefined when the run did not reach it.
 * Independent builtin first-action/prestige facts survive sample caps. Other keys require
 * complete coverage, and a truncated legacy log cannot prove the earliest occurrence.
 */
export function milestoneTime(report: MilestoneReport, key: string): number | undefined {
  const coverage = report.coverage ?? "complete";
  const firstTime = key === "prestige.first" ? report.firstPrestigeSec
    : key === "action.first" ? report.firstActionSec : undefined;
  // A cap preserves these independent committed facts; a truncated legacy log does not.
  if (coverage !== "incomplete" && firstTime !== undefined) return firstTime;
  if (coverage !== "complete") {
    throw new Error(
      `time to milestone ${key} needs a complete milestone report; this one is ${coverage}, so the key may be missing or late`,
    );
  }
  return report.milestones.find((entry) => entry.key === key)?.firstSeenSec;
}

/**
 * Seconds to the first milestone. The sample cap keeps the earliest keys, so a partial report with a
 * sample still holds the first one. An incomplete report came from a cut log and does not.
 */
export function firstMilestoneTime(report: MilestoneReport): number | undefined {
  if (report.coverage === "incomplete") {
    throw new Error("time to the first milestone needs milestone samples; this report came from a truncated log");
  }
  // A partial report with no sample may have dropped the first one, so it is not "unreached".
  if (report.coverage === "partial" && report.firstMilestoneSec === undefined) {
    throw new Error("time to the first milestone is unknown; this partial report kept no milestone sample");
  }
  return report.firstMilestoneSec;
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
      if (!args.milestoneKey) return firstMilestoneTime(args.snapshot.milestones) ?? fallback;
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
  /** Factories and original params that rebuild the model and strategy for every draw. */
  registries?: RunFactoryDeps;
  isolation?: RunBindOptions;
}): ExperienceNumericSummary {
  const fallbackValue = args.sessionPattern.days * 86400 + 1;
  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: args.sessionPattern,
    draws: args.draws,
    seed: args.seed,
    registries: args.registries,
    isolation: args.isolation,
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
  const seconds = (value: number | undefined, digits = 2) =>
    value === undefined || !Number.isFinite(value) ? "n/a" : `${formatMetric(value, digits)}s`;
  const coverage = snapshot.milestones.coverage ?? "complete";
  const firstTime = coverage === "incomplete" ? undefined
    : snapshot.milestones.firstMilestoneSec ?? snapshot.milestones.milestones[0]?.firstSeenSec;
  const firstMilestone = snapshot.milestones.milestones.find((entry) => entry.firstSeenSec === firstTime);
  const firstLabel = firstTime !== undefined
    ? `${seconds(firstTime)}${firstMilestone ? ` (\`${firstMilestone.key}\`)` : " (key sample omitted)"}`
    : coverage === "complete" ? "none observed" : `unknown (${coverage} coverage)`;
  const firstPrestige = coverage === "incomplete" ? undefined : snapshot.milestones.firstPrestigeSec;
  const milestoneLines =
    snapshot.milestones.milestones.length > 0
      ? snapshot.milestones.milestones
          .slice(0, 8)
          .map((entry) => `- \`${entry.key}\`: ${seconds(entry.firstSeenSec)} (${entry.source}${coverage === "incomplete" ? "; retained log occurrence" : ""})`)
      : [coverage === "complete" ? "- none observed" : `- No milestone samples retained (${coverage} coverage).`];
  const slowWindows = snapshot.growth.segments
    .filter((segment) => segment.regime === "stall" || segment.regime === "softcap");
  const growthRows = [...slowWindows]
    .sort((a, b) => (b.tTo - b.tFrom) - (a.tTo - a.tFrom) || a.tFrom - b.tFrom)
    .slice(0, 8)
    .map((segment) => `| ${seconds(segment.tFrom)} | ${seconds(segment.tTo)} | ${segment.regime} | ${formatMetric(segment.slope, 6)} |`);

  const lines = [
    "# Experience Report",
    "",
    `- Scenario: \`${args.scenarioPath}\``,
    `- Intent: ${args.intent ?? "unspecified"}`,
    `- Mode: ${args.mode}`,
    `- Session pattern: \`${snapshot.session.pattern.id}\` for ${snapshot.session.pattern.days} day(s)`,
    `- Active blocks: ${snapshot.session.activeBlocks}${snapshot.session.budgetStops > 0 ? ` (${snapshot.session.budgetStops} cut short by maxSteps)` : ""}`,
    `- Active / offline: ${formatMetric(snapshot.session.totalActiveSec, 0)}s / ${formatMetric(snapshot.session.totalOfflineSec, 0)}s`,
    `- Wall elapsed / horizon: ${formatMetric(snapshot.session.elapsedSec, 0)}s / ${formatMetric(snapshot.session.horizonSec, 0)}s (${snapshot.session.stopReason})`,
    `- Reward time: ${formatMetric(snapshot.session.rewardSec, 0)}s`,
    `- Active time: ${formatMetric(snapshot.session.activeSec, 0)}s`,
    `- Offline wall / credited / lost: ${formatMetric(snapshot.session.offlineElapsedSec, 0)}s / ${formatMetric(snapshot.session.offlineCreditedSec, 0)}s / ${formatMetric(snapshot.session.lostRewardSec, 0)}s`,
    "",
    "## End State",
    "",
    `- End money: \`${snapshot.endMoney}\``,
    `- End net worth: \`${snapshot.endNetWorth}\``,
    `- End net worth (log10): ${formatMetric(snapshot.endNetWorthLog10, 3)}`,
    "",
    "## Perceived Progression",
    "",
    `- First visible change: ${seconds(snapshot.perceived.firstVisibleChangeSec)}`,
    `- Visible changes / minute: ${formatMetric(snapshot.perceived.visibleChangesPerMinute, 3)}`,
    `- Longest no-reward gap: ${seconds(snapshot.perceived.maxNoRewardGapSec)}`,
    `- Avg post-purchase feedback: ${seconds(snapshot.perceived.avgPostPurchaseFeedbackSec)}`,
    `- P95 post-purchase feedback: ${seconds(snapshot.perceived.p95PostPurchaseFeedbackSec)}`,
    "",
    "## Milestones",
    "",
    `- Milestone coverage: ${coverage}`,
    `- First milestone: ${firstLabel}`,
    ...milestoneLines,
    "",
    "## Measured Prestige",
    "",
    `- First prestige: ${firstPrestige === undefined ? (coverage === "complete" ? "not observed" : `unknown (${coverage} coverage)`) : seconds(firstPrestige)}`,
    `- Final prestige count: ${snapshot.endPrestige?.count ?? "n/a"}`,
    `- Final prestige points: ${snapshot.endPrestige ? `\`${snapshot.endPrestige.points}\`` : "n/a"}`,
    `- Final prestige multiplier: ${snapshot.endPrestige ? `\`${snapshot.endPrestige.multiplier}\`` : "n/a"}`,
    "- These are recorded state and timing. Estimating prestige's net benefit requires a counterfactual run under the same conditions.",
    "",
    "## Growth",
    "",
    `- Series requested: \`${snapshot.growth.seriesRequested}\``,
    `- Value source: \`${snapshot.growth.valueSource}\``,
    `- Configured sampling window: ${snapshot.growth.windowSec}s`,
    `- Segments: ${snapshot.growth.segments.length}`,
    `- Bottlenecks: ${snapshot.growth.bottlenecks.length}`,
    "",
    "### Longest observed stall and softcap windows",
    "",
    ...(growthRows.length ? ["| From | To | Regime | Log10 slope / second |", "| --- | --- | --- | --- |", ...growthRows]
      : ["- No stall or softcap window classified in the sampled trace."]),
    ...(slowWindows.length > growthRows.length ? ["", `- Showing ${growthRows.length} of ${slowWindows.length} classified windows.`] : []),
    "",
    `- The configured window is used when downsampling long traces; read actual intervals from the table. Classification uses the \`${snapshot.growth.valueSource}\` series; windows are observations, not a cause diagnosis.`,
    ...(snapshot.session.budgetStops > 0 ? ["- Active play was cut short by maxSteps; read these windows and progression rates with that time budget in mind."] : []),
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
