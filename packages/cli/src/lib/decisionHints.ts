import type { CompareKpiRow, GrowthReport, UXFlag } from "@idlekit/core";

/**
 * Decision hints: short, data-grounded reading aids appended to Markdown reports.
 * Every line cites a measured value from the same report. A hint points at a direction to test; it is not a
 * causal diagnosis, so each section closes with how to verify it with a matched run.
 */
export type DecisionHints = Readonly<{
  bottlenecks: readonly string[];
  adjustments: readonly string[];
  risks: readonly string[];
}>;

export type DesignIntent = "frequent-progression" | "scale-fantasy" | "strategic-optimization";

/** Pacing targets per design intent. A report without an intent uses the default row. */
export type PacingTargets = Readonly<{
  firstVisibleSec: number;
  visibleChangesPerMinute: number;
  maxNoRewardGapSec: number;
  p95FeedbackSec: number;
}>;

export const PACING_TARGETS: Readonly<Record<DesignIntent | "default", PacingTargets>> = {
  "frequent-progression": { firstVisibleSec: 5, visibleChangesPerMinute: 2, maxNoRewardGapSec: 60, p95FeedbackSec: 3 },
  default: { firstVisibleSec: 15, visibleChangesPerMinute: 1, maxNoRewardGapSec: 180, p95FeedbackSec: 10 },
  "scale-fantasy": { firstVisibleSec: 15, visibleChangesPerMinute: 0.5, maxNoRewardGapSec: 300, p95FeedbackSec: 10 },
  "strategic-optimization": { firstVisibleSec: 30, visibleChangesPerMinute: 0.25, maxNoRewardGapSec: 600, p95FeedbackSec: 15 },
};

/** Share of the sampled growth trace in stall or softcap windows that counts as a bottleneck. */
export const SLOW_WINDOW_SHARE = 0.25;
/** Share of offline wall time that the cap or decay discards before it is called out as a risk. */
export const OFFLINE_LOSS_SHARE = 0.25;

function intentKey(intent: string | undefined): DesignIntent | "default" {
  return intent === "frequent-progression" || intent === "scale-fantasy" || intent === "strategic-optimization" ? intent : "default";
}

function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(digits));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function sec(value: number): string {
  return `${fmt(value, 4)}s`;
}

/** A duration in the largest unit that keeps it readable: s, m, h, or d. */
function dur(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs < 120) return `${fmt(value, 3)}s`;
  if (abs < 7200) return `${fmt(value / 60, 3)}m`;
  if (abs < 172800) return `${fmt(value / 3600, 3)}h`;
  return `${fmt(value / 86400, 3)}d`;
}

/** Share of the trace in exponential windows needed before their median slope is used as a what-if reference. */
export const REFERENCE_EXP_SHARE = 0.1;

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${fmt(value, 3)}%`;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Stall and softcap coverage of the growth trace. When exponential windows cover enough of the trace, their median
 * slope is a what-if reference: how long the longest slow window would take at that pace for the same progress.
 */
export function slowWindowSummary(growth: Pick<GrowthReport, "segments">): Readonly<{
  share: number;
  slowSec: number;
  totalSec: number;
  windows: number;
  firstSlowSec?: number;
  endDoublingSec?: number;
  longest?: Readonly<{ tFrom: number; tTo: number; regime: string; slope: number }>;
  referenceSlope?: number;
  /** Seconds the longest window would take at the reference slope for the same log10 progress. */
  estimatedSec?: number;
}> {
  const segments = growth.segments;
  const first = segments[0];
  const last = segments.at(-1);
  const totalSec = first && last ? last.tTo - first.tFrom : 0;
  const span = (segment: Readonly<{ tFrom: number; tTo: number }>) => Math.max(0, segment.tTo - segment.tFrom);
  const slow = segments.filter((segment) => segment.regime === "stall" || segment.regime === "softcap");
  const fast = segments.filter((segment) => (segment.regime === "exp" || segment.regime === "super-exp") && segment.slope > 0);
  const slowSec = slow.reduce((sum, segment) => sum + span(segment), 0);
  const fastSec = fast.reduce((sum, segment) => sum + span(segment), 0);
  // Longest first; among equal windows, the slowest, then the earliest.
  const longest = [...slow].sort((a, b) => span(b) - span(a) || a.slope - b.slope || a.tFrom - b.tFrom)[0];
  const referenceSlope = totalSec > 0 && fastSec / totalSec >= REFERENCE_EXP_SHARE ? median(fast.map((segment) => segment.slope)) : undefined;
  const estimatedSec = longest && referenceSlope !== undefined && referenceSlope > 0
    ? (span(longest) * Math.max(0, longest.slope)) / referenceSlope
    : undefined;
  return {
    share: totalSec > 0 ? slowSec / totalSec : 0,
    slowSec,
    totalSec,
    windows: slow.length,
    ...(slow[0] ? { firstSlowSec: slow[0].tFrom } : {}),
    ...(last?.doublingTimeSec !== undefined && Number.isFinite(last.doublingTimeSec) ? { endDoublingSec: last.doublingTimeSec } : {}),
    ...(longest ? { longest } : {}),
    ...(referenceSlope !== undefined ? { referenceSlope } : {}),
    ...(estimatedSec !== undefined ? { estimatedSec } : {}),
  };
}

const UX_FLAG_TEXT: Readonly<Record<UXFlag["code"], string>> = {
  TOO_MANY_DROPS: "most income events were dropped",
  TOO_RARE_FLUSH: "queued income rarely flushed",
  STALLING_FEELING: "no action applied while purchases kept failing for funds",
};

export type ExperienceHintInput = Readonly<{
  intent?: string;
  perceived: Readonly<{
    firstVisibleChangeSec?: number;
    visibleChangesPerMinute: number;
    maxNoRewardGapSec: number;
    p95PostPurchaseFeedbackSec?: number;
    visibleChangeCount: number;
    activeSeconds: number;
  }>;
  growth: Pick<GrowthReport, "segments">;
  milestones: Readonly<{ coverage?: string }>;
  session: Readonly<{ budgetStops: number; lostRewardSec: number; offlineElapsedSec: number }>;
  endNetWorthLog10?: number;
  monteCarlo?: Readonly<{
    firstVisible: Readonly<{
      accounting: Readonly<{ rightCensored: number; failed: number; unsupported: number }>;
      population: Readonly<{ status: string }>;
    }>;
  }>;
  uxFlags?: readonly UXFlag[];
  /** False when LTV ran on default monetization and retention assumptions. */
  monetizationConfigured?: boolean;
}>;

/** Hints for experience and evaluate reports, from pacing, growth, and data-quality measurements. */
export function experienceDecisionHints(input: ExperienceHintInput): DecisionHints {
  const key = intentKey(input.intent);
  const target = PACING_TARGETS[key];
  const label = key === "default" ? "default (no design intent)" : `\`${key}\``;
  const bottlenecks: string[] = [];
  const adjustments: string[] = [];
  const risks: string[] = [];
  const p = input.perceived;

  if (p.activeSeconds > 0) {
    if (p.firstVisibleChangeSec !== undefined && Number.isFinite(p.firstVisibleChangeSec)) {
      if (p.firstVisibleChangeSec > target.firstVisibleSec) {
        const cut = (1 - target.firstVisibleSec / p.firstVisibleChangeSec) * 100;
        bottlenecks.push(`First visible change at ${sec(p.firstVisibleChangeSec)} is later than the ${label} target of ${sec(target.firstVisibleSec)}.`);
        adjustments.push(`Bring the first visible change forward by about ${fmt(cut, 3)}% (${sec(p.firstVisibleChangeSec)} → ${sec(target.firstVisibleSec)}): lower the first purchase cost or raise starting income, then rerun with the same seed.`);
      }
    } else if (p.visibleChangeCount === 0) {
      bottlenecks.push(`No visible change in ${sec(p.activeSeconds)} of active play.`);
      adjustments.push("Make early progress visible: a first purchase the starting income can afford, or a milestone the first minute reaches.");
    }
    if (p.visibleChangesPerMinute < target.visibleChangesPerMinute) {
      const factor = p.visibleChangesPerMinute > 0 ? target.visibleChangesPerMinute / p.visibleChangesPerMinute : Number.POSITIVE_INFINITY;
      bottlenecks.push(`Visible changes per minute is ${fmt(p.visibleChangesPerMinute)}, below the ${label} target of ${fmt(target.visibleChangesPerMinute)}.`);
      adjustments.push(Number.isFinite(factor)
        ? `Raise visible cadence about ${fmt(factor)}x: add cheaper intermediate purchases or milestone feedback between the current ones.`
        : "Add visible feedback to the active window: cheaper purchases or milestones that the current income reaches.");
    }
    if (p.maxNoRewardGapSec > target.maxNoRewardGapSec) {
      const cut = (1 - target.maxNoRewardGapSec / p.maxNoRewardGapSec) * 100;
      bottlenecks.push(`Longest no-reward gap is ${sec(p.maxNoRewardGapSec)}, above the ${label} limit of ${sec(target.maxNoRewardGapSec)}.`);
      adjustments.push(`Shorten the longest wait by about ${fmt(cut, 3)}%: flatten the cost step that opens the gap or add a reward inside it.`);
    }
    if (p.p95PostPurchaseFeedbackSec !== undefined && p.p95PostPurchaseFeedbackSec > target.p95FeedbackSec) {
      bottlenecks.push(`P95 post-purchase feedback is ${sec(p.p95PostPurchaseFeedbackSec)}, above the ${label} limit of ${sec(target.p95FeedbackSec)}.`);
      adjustments.push("Make purchases pay back visibly sooner: raise the income a purchase adds or show its effect immediately.");
    }
  }

  const slow = slowWindowSummary(input.growth);
  if (slow.windows > 0 && slow.share >= SLOW_WINDOW_SHARE && slow.longest) {
    const longestSec = slow.longest.tTo - slow.longest.tFrom;
    const doubling = slow.endDoublingSec !== undefined ? `; by the end the tracked value doubles every ${dur(slow.endDoublingSec)}` : "";
    bottlenecks.push(`Stall and softcap windows cover ${fmt(slow.share * 100)}% of the sampled growth trace (${slow.windows} window(s)); growth first slows at ${dur(slow.firstSlowSec ?? slow.longest.tFrom)}${doubling}.`);
    if (slow.estimatedSec !== undefined && slow.referenceSlope !== undefined && longestSec > 0) {
      const saving = (1 - slow.estimatedSec / longestSec) * 100;
      adjustments.push(`Ease the curve around ${dur(slow.longest.tFrom)}–${dur(slow.longest.tTo)} (${slow.longest.regime}): lower the cost growth rate there or unlock income earlier. At the run's median exponential slope (${fmt(slow.referenceSlope, 4)} log10/s) that window's progress would take about ${dur(slow.estimatedSec)} instead of ${dur(longestSec)} (${fmt(saving, 3)}% shorter); probe the cost growth with \`idk experiment\` to measure the real effect.`);
    } else {
      adjustments.push(`Growth leaves the exponential regime at ${dur(slow.firstSlowSec ?? slow.longest.tFrom)}. If sustained growth is intended, add a growth source there (a new tier, multiplier, or prestige) or lower the cost growth rate, then measure the change with \`idk experiment\`; a long plateau can also be the intended late game.`);
    }
  }

  if (input.session.budgetStops > 0) {
    risks.push(`${input.session.budgetStops} active block(s) were cut short by maxSteps; rates and waits describe shortened play.`);
  }
  const coverage = input.milestones.coverage ?? "complete";
  if (coverage !== "complete") risks.push(`Milestone coverage is ${coverage}; milestone timings may be missing.`);
  if (input.session.offlineElapsedSec > 0) {
    const lost = input.session.lostRewardSec / input.session.offlineElapsedSec;
    if (lost > OFFLINE_LOSS_SHARE) {
      risks.push(`The offline cap or decay discarded ${fmt(lost * 100)}% of offline time (${sec(input.session.lostRewardSec)} of ${sec(input.session.offlineElapsedSec)}); returning players may feel under-rewarded.`);
    }
  }
  if (input.endNetWorthLog10 !== undefined && !Number.isFinite(input.endNetWorthLog10)) {
    risks.push("End net worth left the finite range of the engine; use a big-number engine before reading late-game values.");
  }
  if (input.monteCarlo) {
    const accounting = input.monteCarlo.firstVisible.accounting;
    const unresolved = accounting.rightCensored + accounting.failed + accounting.unsupported;
    if (unresolved > 0) {
      risks.push(`Monte Carlo: ${accounting.rightCensored} right-censored, ${accounting.failed} failed, and ${accounting.unsupported} unsupported draw(s); timing statistics describe completed draws only.`);
    }
    if (input.monteCarlo.firstVisible.population.status !== "observed") {
      risks.push(`Monte Carlo population p95 is ${input.monteCarlo.firstVisible.population.status}.`);
    }
  }
  for (const flag of input.uxFlags ?? []) {
    risks.push(`Simulate flagged \`${flag.code}\` (${flag.severity}): ${UX_FLAG_TEXT[flag.code] ?? "see the simulate output"}.`);
  }
  if (input.monetizationConfigured === false) {
    risks.push("LTV used default monetization and retention assumptions; calibrate them before reading revenue figures.");
  }

  return { bottlenecks, adjustments, risks };
}

export type CompareHintResult = Readonly<{ metric: string; better?: unknown }>;

/** Hints for A/B compare reports, from KPI rows and the comparison warnings. */
export function compareDecisionHints(args: Readonly<{ rows: readonly CompareKpiRow[]; warnings: readonly string[] }>): DecisionHints {
  const bottlenecks: string[] = [];
  const adjustments: string[] = [];
  const risks: string[] = [];
  const change = (row: CompareKpiRow) =>
    row.relativeChangePct !== null
      ? pct(row.relativeChangePct)
      : row.log10Delta !== null
        ? `${row.log10Delta >= 0 ? "+" : ""}${fmt(row.log10Delta)} log10`
        : "n/a";
  const aWins = args.rows.filter((row) => row.better === "a");
  const bWins = args.rows.filter((row) => row.better === "b");
  const ties = args.rows.filter((row) => row.better === "tie");
  for (const row of aWins) {
    bottlenecks.push(`B trails A on \`${row.metric}\` (${row.preference} is better): ${row.a ?? "n/a"} → ${row.b ?? "n/a"} (${change(row)}).`);
  }
  if (args.rows.length > 0) {
    if (bWins.length > aWins.length) {
      adjustments.push(`B wins ${bWins.length} of ${args.rows.length} KPI(s) (${bWins.map((row) => `\`${row.metric}\` ${change(row)}`).join(", ")}). Move toward B${aWins.length > 0 ? `, then recover ${aWins.map((row) => `\`${row.metric}\``).join(", ")}` : ""}.`);
    } else if (aWins.length > bWins.length) {
      adjustments.push(`A wins ${aWins.length} of ${args.rows.length} KPI(s). Keep A${bWins.length > 0 ? ` and port what makes B better on ${bWins.map((row) => `\`${row.metric}\``).join(", ")}` : ""}.`);
    } else {
      adjustments.push(`Neither side leads (${aWins.length} A, ${bWins.length} B, ${ties.length} tie). Choose by the KPI that matters most for the design intent, or narrow the difference with \`idk experiment\`.`);
    }
  }
  for (const row of args.rows) {
    if (row.better === "undetermined") risks.push(`\`${row.metric}\` could not be ranked.`);
  }
  if (args.warnings.length > 0) {
    risks.push(`${args.warnings.length} comparison warning(s) apply (see Comparison notes); the KPI differences may not be like for like.`);
  }
  return { bottlenecks, adjustments, risks };
}

export type ExperimentHintInput = Readonly<{
  candidates: readonly Readonly<{
    id: string;
    metrics: readonly Readonly<{ metricId: string; status: string; value: string | null }>[];
    constraintViolations: readonly string[];
  }>[];
  elasticities: readonly Readonly<{
    dimensionId: string;
    candidateId: string;
    metricId: string;
    status: string;
    elasticity: string | null;
    direction: string;
  }>[];
  pareto: Readonly<{ nonDominated: readonly string[]; uncompared: readonly string[] }>;
  /** Spec objectives, so a move can be called better or worse. */
  objectives?: readonly Readonly<{ id: string; metricId: string; sense: "lower" | "higher" }>[];
}>;

function relativeChange(baseline: string | null | undefined, probe: string | null | undefined): number | null {
  if (baseline === null || baseline === undefined || probe === null || probe === undefined) return null;
  const b = Number(baseline);
  const p = Number(probe);
  if (!Number.isFinite(b) || !Number.isFinite(p) || b === 0) return null;
  const change = ((p - b) / Math.abs(b)) * 100;
  return Number.isFinite(change) ? change : null;
}

/** Hints for experiment reports: the strongest local lever per metric, with the observed probe change. */
export function experimentDecisionHints(input: ExperimentHintInput): DecisionHints {
  const bottlenecks: string[] = [];
  const adjustments: string[] = [];
  const risks: string[] = [];
  const valueOf = (candidateId: string, metricId: string) =>
    input.candidates.find((candidate) => candidate.id === candidateId)?.metrics.find((metric) => metric.metricId === metricId);
  const metrics = [...new Set(input.elasticities.map((row) => row.metricId))];
  for (const metricId of metrics) {
    const observed = input.elasticities
      .filter((row) => row.metricId === metricId && row.status === "observed" && row.elasticity !== null)
      .map((row) => ({ row, e: Number(row.elasticity) }))
      .filter((entry) => Number.isFinite(entry.e));
    const strongest = [...observed].sort((a, b) => Math.abs(b.e) - Math.abs(a.e) || (a.row.candidateId < b.row.candidateId ? -1 : a.row.candidateId > b.row.candidateId ? 1 : 0))[0];
    if (!strongest) continue;
    const base = valueOf("baseline", metricId);
    const probe = valueOf(strongest.row.candidateId, metricId);
    const change = relativeChange(base?.value, probe?.value);
    const objective = input.objectives?.find((entry) => entry.metricId === metricId);
    const verdict = objective && (strongest.row.direction === "higher" || strongest.row.direction === "lower")
      ? `, ${strongest.row.direction === objective.sense ? "better" : "worse"} for objective \`${objective.id}\``
      : "";
    adjustments.push(`\`${metricId}\` responds most to \`${strongest.row.dimensionId}\`: probe \`${strongest.row.candidateId}\` moved it ${strongest.row.direction}${verdict} (${base?.value ?? "n/a"} → ${probe?.value ?? "n/a"}${change !== null ? `, ${pct(change)}` : ""}; local elasticity ${fmt(strongest.e)}).`);
    const flat = observed.filter((entry) => entry.e === 0).map((entry) => `\`${entry.row.dimensionId}\``);
    if (flat.length > 0) bottlenecks.push(`\`${metricId}\` did not move for ${[...new Set(flat)].join(", ")}; those probes are not levers for it at this horizon.`);
  }
  for (const candidate of input.candidates) {
    if (candidate.constraintViolations.length > 0) {
      bottlenecks.push(`Candidate \`${candidate.id}\` violates ${candidate.constraintViolations.map((id) => `\`${id}\``).join(", ")}.`);
    }
  }
  if (input.pareto.nonDominated.length > 0) {
    adjustments.push(`Non-dominated candidates: ${input.pareto.nonDominated.map((id) => `\`${id}\``).join(", ")}.`);
  }
  const unavailable = input.elasticities.filter((row) => row.status !== "observed").length;
  if (unavailable > 0) risks.push(`${unavailable} elasticity cell(s) are unavailable (a censored, failed, or zero baseline reading).`);
  if (input.pareto.uncompared.length > 0) {
    risks.push(`Uncompared candidates (missing readings): ${input.pareto.uncompared.map((id) => `\`${id}\``).join(", ")}.`);
  }
  risks.push("Elasticities are one-at-a-time and local around the baseline; interactions between parameters are not measured.");
  return { bottlenecks, adjustments, risks };
}

/** The `## Decision hints` Markdown section. Empty groups say so, so the structure is stable. */
export function renderDecisionHints(hints: DecisionHints, options: Readonly<{ verify: string }>): string[] {
  const group = (title: string, items: readonly string[], empty: string) => [
    `### ${title}`,
    "",
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${empty}`]),
    "",
  ];
  return [
    "## Decision hints",
    "",
    ...group("Bottlenecks", hints.bottlenecks, "None crossed the thresholds in this run."),
    ...group("Recommended adjustment direction", hints.adjustments, "No change indicated by these measurements."),
    ...group("Risk summary", hints.risks, "No data-quality risk detected."),
    `_Hints are heuristics computed from this report's measurements. ${options.verify}_`,
  ];
}
