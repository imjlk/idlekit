import { defineCommand, option } from "@bunli/core";
import {
  compareScenarios,
  compileScenario,
  createNumberEngine,
  createRunFactory,
  parseMoney,
  runElapsedSec,
  runScenario,
  validateScenarioV1,
  type RunBindOptions,
  type ScenarioV1,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { betterFromCmp, formatEtaLabel, toComparableEta } from "./_shared/compareEval";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import {
  collectExperienceSnapshot,
  comparableExperienceMetric,
  resolveExperienceDraws,
  resolveExperienceQuantiles,
  resolveExperienceSeries,
  resolveSessionPatternId,
  resolveSessionPatternSpec,
  summarizeComparableExperienceMetric,
} from "../lib/experience";
import { defaultRunSeed, pluginDigestValues, resolveStrategySelection } from "../lib/runConfiguration";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicRunId } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();
const compareMetricSchema = z.enum([
  "endMoney",
  "endNetWorth",
  "etaToTargetWorth",
  "droppedRate",
  "timeToMilestone",
  "visibleChangesPerMinute",
  "maxNoRewardGapSec",
]);
const compareBundleSchema = z.enum(["economy", "design", "full"]).optional();

type CompareMetric = z.infer<typeof compareMetricSchema>;
type CompareBundle = NonNullable<z.infer<typeof compareBundleSchema>>;

function assertValidScenario(
  label: "A" | "B",
  valid: ReturnType<typeof validateScenarioV1>,
): NonNullable<ReturnType<typeof validateScenarioV1>["scenario"]> {
  if (!valid.ok || !valid.scenario) {
    throw scenarioInvalidError(valid.issues, label);
  }
  return valid.scenario;
}

function compileComparableScenario(args: {
  scenario: ScenarioV1;
  E: ReturnType<typeof createNumberEngine>;
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>;
  flags: {
    strategy?: string;
    step?: number;
    duration?: number;
    fast: boolean;
    seed?: number;
  };
}) {
  const selected = resolveStrategySelection({
    scenario: args.scenario,
    strategyRegistry: args.loaded.strategyRegistry,
    overrideId: args.flags.strategy,
  });
  // The binding builds the selected strategy for every run. An override never builds the replaced one.
  const { strategy: _replaced, ...withoutStrategy } = args.scenario;
  const compiled = compileScenario<number, string, Record<string, unknown>>({
    E: args.E,
    scenario: withoutStrategy,
    registry: args.loaded.modelRegistry,
    strategyRegistry: args.loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });

  const definition = {
    ...compiled,
    ctx: {
      ...compiled.ctx,
      seed: args.flags.seed ?? compiled.ctx.seed,
    },
    run: {
      ...compiled.run,
      eventLog: {
        enabled: false,
        maxEvents: 0,
      },
      stepSec: args.flags.step ?? compiled.run.stepSec,
      durationSec: args.flags.duration ?? compiled.run.durationSec,
      fast: args.flags.fast
        ? { enabled: true as const, kind: "log-domain" as const, disableMoneyEvents: true }
        : compiled.run.fast,
    },
  };
  const registries = { models: args.loaded.modelRegistry, strategies: args.loaded.strategyRegistry };
  const isolation: RunBindOptions = {
    model: args.scenario.model,
    ...(selected.id !== undefined
      ? { strategy: { id: selected.id, params: selected.params, paramsMode: selected.paramsMode } }
      : {}),
  };
  const binding = createRunFactory(registries).bind(definition, isolation);
  return {
    registries,
    isolation,
    fresh: (trialId: string) => binding.fresh({ trialId, seed: definition.ctx.seed }).scenario,
  };
}

// The `--max-duration` default. The option keeps the literal for the generated CLI metadata.
const DEFAULT_MAX_DURATION = 86400;

type CompareFlags = Readonly<{
  strategy?: string;
  step?: number;
  duration?: number;
  fast: boolean;
  metric?: CompareMetric;
  bundle?: CompareBundle;
  "target-worth"?: string;
  "max-duration": number;
  "milestone-key"?: string;
  "session-pattern"?: string;
  days?: number;
  draws?: number;
}>;

function isDesignMetric(metric: CompareMetric): metric is "timeToMilestone" | "visibleChangesPerMinute" | "maxNoRewardGapSec" {
  return metric === "timeToMilestone" || metric === "visibleChangesPerMinute" || metric === "maxNoRewardGapSec";
}

function compareMetrics(flags: CompareFlags): readonly CompareMetric[] {
  return flags.bundle ? bundleMetrics(flags.bundle) : [flags.metric ?? "endNetWorth"];
}

function compareMilestoneKey(flags: CompareFlags): string | undefined {
  return flags.bundle
    ? (flags["milestone-key"] ?? (compareMetrics(flags).includes("timeToMilestone") ? "progress.first-upgrade" : undefined))
    : flags["milestone-key"];
}

/**
 * What a compare runs for each scenario and what it measures. A flag counts only where it changes
 * the run: session flags only for a design metric, the milestone key only for timeToMilestone, and
 * max duration only with a target worth.
 */
function compareIdentity(args: {
  scenarios: Readonly<{ a: ScenarioV1; b: ScenarioV1 }>;
  flags: CompareFlags;
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>;
}): Record<string, unknown> {
  const { flags } = args;
  const metrics = compareMetrics(flags);
  const design = metrics.some(isDesignMetric);
  const side = (scenario: ScenarioV1) => {
    const strategy = (() => {
      try {
        const selected = resolveStrategySelection({
          scenario,
          strategyRegistry: args.loaded.strategyRegistry,
          overrideId: flags.strategy,
        });
        return { id: selected.id ?? null, params: selected.params ?? null };
      } catch {
        // A scenario strategy that does not resolve fails the run without an override.
        return { unresolved: scenario.strategy?.id ?? null };
      }
    })();
    return {
      scenario,
      strategy,
      stepSec: flags.step ?? scenario.clock.stepSec,
      durationSec: flags.duration ?? scenario.clock.durationSec ?? null,
      fast: flags.fast || scenario.sim?.fast === true,
      session: design
        ? {
            ...resolveSessionPatternSpec({
              scenario,
              sessionPatternId: resolveSessionPatternId(flags["session-pattern"]),
              days: flags.days,
            }),
            draws: resolveExperienceDraws(scenario, flags.draws),
          }
        : null,
    };
  };
  return {
    a: side(args.scenarios.a),
    b: side(args.scenarios.b),
    pluginDigests: pluginDigestValues(args.loaded.pluginDigest),
    metrics,
    bundle: flags.bundle ?? null,
    eta: flags["target-worth"] ? { targetWorth: flags["target-worth"], maxDuration: flags["max-duration"] } : null,
    milestoneKey: metrics.includes("timeToMilestone") ? (compareMilestoneKey(flags) ?? null) : null,
  };
}

function measureScenario(args: {
  compiled: ReturnType<typeof compileComparableScenario>;
  E: ReturnType<typeof createNumberEngine>;
  targetWorth?: string;
  maxDuration: number;
}) {
  const runInput = args.compiled.fresh("economy");
  const run = runScenario(runInput);
  const endWorth = runInput.model.netWorth?.(runInput.ctx, run.end) ?? run.end.wallet.money;

  let etaSeconds: number | undefined;
  let etaReached: boolean | undefined;
  if (args.targetWorth) {
    const etaInput = args.compiled.fresh("eta");
    const target = parseMoney(args.E, args.targetWorth, {
      unit: etaInput.ctx.unit,
      suffix: { kind: "alphaInfinite", minLen: 2 },
    }).amount;

    const reachedFn = (s: typeof run.end) =>
      args.E.cmp((etaInput.model.netWorth?.(etaInput.ctx, s) ?? s.wallet.money).amount, target) >= 0;

    const etaRun = runScenario({
      ...etaInput,
      run: {
        ...etaInput.run,
        durationSec: args.maxDuration,
        trace: undefined,
        until: reachedFn,
      },
    });

    etaReached = reachedFn(etaRun.end);
    etaSeconds = etaReached ? runElapsedSec(etaRun) : Number.POSITIVE_INFINITY;
  }

  return {
    run,
    endMoney: run.end.wallet.money.amount,
    endNetWorth: endWorth.amount,
    droppedRate: run.stats?.money.droppedRate ?? 0,
    etaToTargetWorth: etaSeconds,
    etaReached,
  };
}

function measureDesignMetric(args: {
  compiled: ReturnType<typeof compileComparableScenario>;
  metric: "timeToMilestone" | "visibleChangesPerMinute" | "maxNoRewardGapSec";
  sessionPatternId?: string;
  days?: number;
  draws?: number;
  milestoneKey?: string;
}): Readonly<{
  value: number;
  snapshot: ReturnType<typeof collectExperienceSnapshot<any, any, any>>["snapshot"];
}> {
  const scenario = args.compiled.fresh(`design:${args.metric}`);
  const sessionPattern = resolveSessionPatternSpec({
    scenario,
    sessionPatternId: resolveSessionPatternId(args.sessionPatternId),
    days: args.days,
  });
  const series = resolveExperienceSeries(scenario);
  const draws = Math.max(1, Math.floor(args.draws ?? scenario.analysis?.experience?.draws ?? 1));
  const quantiles = resolveExperienceQuantiles(scenario);
  const fallback = sessionPattern.days * 86400 + 1;

  const deterministic = collectExperienceSnapshot({
    scenario,
    sessionPattern,
    seed: scenario.ctx.seed,
    series,
  });

  if (draws <= 1) {
    return {
      value:
        comparableExperienceMetric({
          snapshot: deterministic.snapshot,
          metric: args.metric,
          milestoneKey: args.milestoneKey,
          fallbackValue: fallback,
        }) ?? fallback,
      snapshot: deterministic.snapshot,
    };
  }

  const summary = summarizeComparableExperienceMetric({
    scenario: args.compiled.fresh(`design:${args.metric}:monte-carlo`),
    sessionPattern,
    metric: args.metric,
    milestoneKey: args.milestoneKey,
    draws,
    seed: scenario.ctx.seed ?? 1,
    quantiles,
    series,
    registries: args.compiled.registries,
    isolation: args.compiled.isolation,
  });

  return {
    value: summary.quantiles.q50 ?? summary.mean,
    snapshot: deterministic.snapshot,
  };
}

function measuredDesignFields(
  metric: string,
  measured: ReturnType<typeof measureDesignMetric> | undefined,
): Readonly<{
  timeToMilestone?: number;
  visibleChangesPerMinute?: number;
  maxNoRewardGapSec?: number;
}> {
  if (!measured) return {};
  switch (metric) {
    case "timeToMilestone":
      return { timeToMilestone: measured.value };
    case "visibleChangesPerMinute":
      return { visibleChangesPerMinute: measured.snapshot.perceived.visibleChangesPerMinute };
    case "maxNoRewardGapSec":
      return { maxNoRewardGapSec: measured.snapshot.perceived.maxNoRewardGapSec };
    default:
      return {};
  }
}

function buildCompareInsights(args: {
  metric: CompareMetric;
  endNetWorthWinner: "a" | "b" | "tie";
  a: {
    endNetWorth: string;
    droppedRate: number;
    etaToTargetWorth?: string;
    timeToMilestone?: number;
    visibleChangesPerMinute?: number;
    maxNoRewardGapSec?: number;
  };
  b: {
    endNetWorth: string;
    droppedRate: number;
    etaToTargetWorth?: string;
    timeToMilestone?: number;
    visibleChangesPerMinute?: number;
    maxNoRewardGapSec?: number;
  };
  better: "a" | "b" | "tie";
}): Readonly<{
  summary: string;
  improved: string[];
  regressed: string[];
  drivers: Array<{
    key:
      | "endNetWorth"
      | "droppedRate"
      | "etaToTargetWorth"
      | "timeToMilestone"
      | "visibleChangesPerMinute"
      | "maxNoRewardGapSec";
    winner: "a" | "b";
    summary: string;
  }>;
}> {
  const improved: string[] = [];
  const regressed: string[] = [];
  const drivers: Array<{
    key:
      | "endNetWorth"
      | "droppedRate"
      | "etaToTargetWorth"
      | "timeToMilestone"
      | "visibleChangesPerMinute"
      | "maxNoRewardGapSec";
    winner: "a" | "b";
    summary: string;
  }> = [];
  const betterLabel = args.better === "tie" ? "none" : args.better.toUpperCase();

  if (args.endNetWorthWinner !== "tie") {
    const winner = args.endNetWorthWinner;
    drivers.push({
      key: "endNetWorth",
      winner,
      summary: `${winner.toUpperCase()} finishes with higher measured net worth.`,
    });
  }

  const aDropped = args.a.droppedRate;
  const bDropped = args.b.droppedRate;
  if (aDropped !== bDropped) {
    const improvedSide = aDropped < bDropped ? "A" : "B";
    const winner = improvedSide.toLowerCase() as "a" | "b";
    improved.push(`${improvedSide} has lower droppedRate (${Math.min(aDropped, bDropped).toFixed(4)})`);
    const regressedSide = improvedSide === "A" ? "B" : "A";
    regressed.push(`${regressedSide} has higher droppedRate (${Math.max(aDropped, bDropped).toFixed(4)})`);
    drivers.push({
      key: "droppedRate",
      winner,
      summary: `${improvedSide} wastes less income to dropped ticks.`,
    });
  }

  if (args.metric === "etaToTargetWorth" && args.a.etaToTargetWorth && args.b.etaToTargetWorth) {
    const aEta = Number(args.a.etaToTargetWorth.replace("*maxDuration", ""));
    const bEta = Number(args.b.etaToTargetWorth.replace("*maxDuration", ""));
    if (Number.isFinite(aEta) && Number.isFinite(bEta) && aEta !== bEta) {
      const faster = aEta < bEta ? "A" : "B";
      improved.push(`${faster} reaches target worth faster`);
      regressed.push(`${faster === "A" ? "B" : "A"} reaches target worth slower`);
      drivers.push({
        key: "etaToTargetWorth",
        winner: faster.toLowerCase() as "a" | "b",
        summary: `${faster} reaches the target worth sooner.`,
      });
    }
  }

  if (
    args.metric === "timeToMilestone" &&
    args.a.timeToMilestone !== undefined &&
    args.b.timeToMilestone !== undefined &&
    args.a.timeToMilestone !== args.b.timeToMilestone
  ) {
    const faster = args.a.timeToMilestone < args.b.timeToMilestone ? "A" : "B";
    improved.push(`${faster} reaches the requested milestone sooner`);
    regressed.push(`${faster === "A" ? "B" : "A"} reaches the requested milestone later`);
    drivers.push({
      key: "timeToMilestone",
      winner: faster.toLowerCase() as "a" | "b",
      summary: `${faster} reaches the selected milestone sooner in measured progression.`,
    });
  }

  if (
    args.metric === "visibleChangesPerMinute" &&
    args.a.visibleChangesPerMinute !== undefined &&
    args.b.visibleChangesPerMinute !== undefined &&
    args.a.visibleChangesPerMinute !== args.b.visibleChangesPerMinute
  ) {
    const moreVisible = args.a.visibleChangesPerMinute > args.b.visibleChangesPerMinute ? "A" : "B";
    improved.push(`${moreVisible} delivers more visible progression changes per active minute`);
    regressed.push(`${moreVisible === "A" ? "B" : "A"} changes the visible number less often`);
    drivers.push({
      key: "visibleChangesPerMinute",
      winner: moreVisible.toLowerCase() as "a" | "b",
      summary: `${moreVisible} changes the visible progression number more often during active play.`,
    });
  }

  if (
    args.metric === "maxNoRewardGapSec" &&
    args.a.maxNoRewardGapSec !== undefined &&
    args.b.maxNoRewardGapSec !== undefined &&
    args.a.maxNoRewardGapSec !== args.b.maxNoRewardGapSec
  ) {
    const shorter = args.a.maxNoRewardGapSec < args.b.maxNoRewardGapSec ? "A" : "B";
    improved.push(`${shorter} keeps the longest no-reward gap shorter`);
    regressed.push(`${shorter === "A" ? "B" : "A"} leaves longer stretches without visible reward`);
    drivers.push({
      key: "maxNoRewardGapSec",
      winner: shorter.toLowerCase() as "a" | "b",
      summary: `${shorter} reduces the worst active-session wait between visible rewards.`,
    });
  }

  return {
    summary: `Measured comparison winner: ${betterLabel}`,
    improved,
    regressed,
    drivers,
  };
}

function bundleMetrics(bundle: CompareBundle): readonly CompareMetric[] {
  switch (bundle) {
    case "economy":
      return ["endMoney", "endNetWorth", "droppedRate"];
    case "design":
      return ["visibleChangesPerMinute", "maxNoRewardGapSec", "timeToMilestone"];
    case "full":
      return ["endMoney", "endNetWorth", "droppedRate", "visibleChangesPerMinute", "maxNoRewardGapSec", "timeToMilestone"];
  }
}

function compareDecisionForMetric(args: {
  metric: CompareMetric;
  E: ReturnType<typeof createNumberEngine>;
  ma: ReturnType<typeof measureScenario>;
  mb: ReturnType<typeof measureScenario>;
  da?: ReturnType<typeof measureDesignMetric>;
  db?: ReturnType<typeof measureDesignMetric>;
  maxDuration: number;
}): "a" | "b" | "tie" | undefined {
  switch (args.metric) {
    case "endMoney":
      return betterFromCmp(args.E.cmp(args.ma.endMoney, args.mb.endMoney));
    case "endNetWorth":
      return betterFromCmp(args.E.cmp(args.ma.endNetWorth, args.mb.endNetWorth));
    case "droppedRate":
      return betterFromCmp(
        args.ma.droppedRate < args.mb.droppedRate ? 1 : args.ma.droppedRate > args.mb.droppedRate ? -1 : 0,
      );
    case "etaToTargetWorth": {
      const aEta = toComparableEta(args.ma.etaToTargetWorth, args.maxDuration);
      const bEta = toComparableEta(args.mb.etaToTargetWorth, args.maxDuration);
      if (aEta === undefined || bEta === undefined) return undefined;
      return betterFromCmp(aEta < bEta ? 1 : aEta > bEta ? -1 : 0);
    }
    case "timeToMilestone":
    case "maxNoRewardGapSec":
      if (args.da?.value === undefined || args.db?.value === undefined) return undefined;
      return betterFromCmp(args.da.value < args.db.value ? 1 : args.da.value > args.db.value ? -1 : 0);
    case "visibleChangesPerMinute":
      if (args.da?.value === undefined || args.db?.value === undefined) return undefined;
      return betterFromCmp(args.da.value > args.db.value ? 1 : args.da.value < args.db.value ? -1 : 0);
  }
}

function buildSingleCompareOutput(args: {
  metric: CompareMetric;
  E: ReturnType<typeof createNumberEngine>;
  aScenario: any;
  bScenario: any;
  ma: ReturnType<typeof measureScenario>;
  mb: ReturnType<typeof measureScenario>;
  da?: ReturnType<typeof measureDesignMetric>;
  db?: ReturnType<typeof measureDesignMetric>;
  maxDuration: number;
}): Record<string, unknown> {
  const result = compareScenarios({
    a: args.aScenario,
    b: args.bScenario,
    metric: args.metric,
    measured: {
      a: {
        endMoney: args.E.absLog10(args.ma.endMoney),
        endNetWorth: args.E.absLog10(args.ma.endNetWorth),
        droppedRate: args.ma.droppedRate,
        etaToTargetWorth: toComparableEta(args.ma.etaToTargetWorth, args.maxDuration),
        ...measuredDesignFields(args.metric, args.da),
      },
      b: {
        endMoney: args.E.absLog10(args.mb.endMoney),
        endNetWorth: args.E.absLog10(args.mb.endNetWorth),
        droppedRate: args.mb.droppedRate,
        etaToTargetWorth: toComparableEta(args.mb.etaToTargetWorth, args.maxDuration),
        ...measuredDesignFields(args.metric, args.db),
      },
    },
    measuredDecision: (metric) =>
      compareDecisionForMetric({
        metric: metric as CompareMetric,
        E: args.E,
        ma: args.ma,
        mb: args.mb,
        da: args.da,
        db: args.db,
        maxDuration: args.maxDuration,
      }),
  });

  return {
    metric: args.metric,
    better: result.better,
    detail: result.detail,
    measured: {
      a: {
        endMoney: args.E.toString(args.ma.endMoney),
        endNetWorth: args.E.toString(args.ma.endNetWorth),
        droppedRate: args.ma.droppedRate,
        etaToTargetWorth:
          args.ma.etaToTargetWorth === undefined
            ? undefined
            : formatEtaLabel(args.ma.etaToTargetWorth, !!args.ma.etaReached),
        ...measuredDesignFields(args.metric, args.da),
      },
      b: {
        endMoney: args.E.toString(args.mb.endMoney),
        endNetWorth: args.E.toString(args.mb.endNetWorth),
        droppedRate: args.mb.droppedRate,
        etaToTargetWorth:
          args.mb.etaToTargetWorth === undefined
            ? undefined
            : formatEtaLabel(args.mb.etaToTargetWorth, !!args.mb.etaReached),
        ...measuredDesignFields(args.metric, args.db),
      },
    },
    insights: buildCompareInsights({
      metric: args.metric,
      endNetWorthWinner: betterFromCmp(args.E.cmp(args.ma.endNetWorth, args.mb.endNetWorth)),
      better: result.better,
      a: {
        endNetWorth: args.E.toString(args.ma.endNetWorth),
        droppedRate: args.ma.droppedRate,
        etaToTargetWorth:
          args.ma.etaToTargetWorth === undefined
            ? undefined
            : formatEtaLabel(args.ma.etaToTargetWorth, !!args.ma.etaReached),
        ...measuredDesignFields(args.metric, args.da),
      },
      b: {
        endNetWorth: args.E.toString(args.mb.endNetWorth),
        droppedRate: args.mb.droppedRate,
        etaToTargetWorth:
          args.mb.etaToTargetWorth === undefined
            ? undefined
            : formatEtaLabel(args.mb.etaToTargetWorth, !!args.mb.etaReached),
        ...measuredDesignFields(args.metric, args.db),
      },
    }),
  };
}

export default defineCommand({
  name: "compare",
  description: "Compare two scenarios via measured simulation metrics",
  options: {
    ...pluginOptions(),
    duration: option(z.coerce.number().optional(), { description: "Override durationSec" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec" }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast(log-domain) mode" }),
    "target-worth": option(z.string().optional(), {
      description: "Required for etaToTargetWorth metric, optional otherwise",
    }),
    "milestone-key": option(z.string().optional(), {
      description: "Required for timeToMilestone metric; compared against milestone report keys",
    }),
    "session-pattern": option(
      z.enum(["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"]).optional(),
      { description: "Session pattern for design metrics" },
    ),
    days: option(z.coerce.number().int().positive().optional(), {
      description: "Session-pattern day count for design metrics",
    }),
    draws: option(z.coerce.number().int().positive().optional(), {
      description: "Monte Carlo draw count for design metrics",
    }),
    "max-duration": option(z.coerce.number().default(86400), {
      description: "Max duration for etaToTargetWorth metric simulation",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed passed to ctx.seed" }),
    "run-id": option(z.string().optional(), {
      description: "Optional run identifier used in output metadata",
    }),
    "artifact-out": option(z.string().optional(), { description: "Write replay artifact JSON to path" }),
    metric: option(compareMetricSchema.optional(), { description: "Comparison metric" }),
    bundle: option(compareBundleSchema, {
      description: "Run a predefined metric bundle (economy|design|full)",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const aPath = positional[0];
    const bPath = positional[1];
    if (!aPath || !bPath) {
      throw usageError(
        "Usage: idk compare <A> <B> [--metric ...] [--plugin ...] [--target-worth <NumStr>]",
      );
    }

    const [aInput, bInput] = await Promise.all([readScenarioFile(aPath), readScenarioFile(bPath)]);
    const loaded = await loadRegistriesFromFlags(flags);

    const aScenario = assertValidScenario("A", validateScenarioV1(aInput, loaded.modelRegistry));
    const bScenario = assertValidScenario("B", validateScenarioV1(bInput, loaded.modelRegistry));

    if (flags.bundle && flags.metric) {
      throw usageError("Use either --metric or --bundle, not both.");
    }

    const selectedMetric: CompareMetric | undefined = flags.bundle ? undefined : (flags.metric ?? "endNetWorth");
    const selectedMetrics = compareMetrics(flags);
    const effectiveMilestoneKey = compareMilestoneKey(flags);

    if (selectedMetrics.includes("etaToTargetWorth") && !flags["target-worth"]) {
      throw usageError("metric=etaToTargetWorth requires --target-worth <NumStr>");
    }
    if (!flags.bundle && selectedMetric === "timeToMilestone" && !effectiveMilestoneKey) {
      throw usageError("metric=timeToMilestone requires --milestone-key <key>");
    }

    const scenarios = { a: aScenario, b: bScenario };
    const identity = compareIdentity({ scenarios, flags, loaded });
    const effectiveSeed =
      flags.seed ??
      defaultRunSeed({
        // The seed input of a run without flags.
        base: {
          command: "compare",
          scenarios,
          options: {
            metric: "endNetWorth",
            bundle: undefined,
            duration: undefined,
            step: undefined,
            strategy: undefined,
            fast: false,
            targetWorth: undefined,
            maxDuration: DEFAULT_MAX_DURATION,
            sessionPattern: undefined,
            days: undefined,
            draws: undefined,
            milestoneKey: undefined,
          },
        },
        runs: [{ identity, defaults: compareIdentity({ scenarios, flags: { fast: false, "max-duration": DEFAULT_MAX_DURATION }, loaded }) }],
      });

    const E = createNumberEngine();

    const aCompiled = compileComparableScenario({
      scenario: aScenario,
      E,
      loaded,
      flags: {
        ...flags,
        seed: effectiveSeed,
      },
    });
    const bCompiled = compileComparableScenario({
      scenario: bScenario,
      E,
      loaded,
      flags: {
        ...flags,
        seed: effectiveSeed,
      },
    });

    const ma = measureScenario({
      compiled: aCompiled,
      E,
      targetWorth: flags["target-worth"],
      maxDuration: flags["max-duration"],
    });
    const mb = measureScenario({
      compiled: bCompiled,
      E,
      targetWorth: flags["target-worth"],
      maxDuration: flags["max-duration"],
    });
    const designCache = new Map<
      CompareMetric,
      Readonly<{
        a: ReturnType<typeof measureDesignMetric>;
        b: ReturnType<typeof measureDesignMetric>;
      }>
    >();
    const getDesignPair = (metric: CompareMetric) => {
      if (
        metric !== "timeToMilestone" &&
        metric !== "visibleChangesPerMinute" &&
        metric !== "maxNoRewardGapSec"
      ) {
        return undefined;
      }
      const cached = designCache.get(metric);
      if (cached) return cached;
      const pair = {
        a: measureDesignMetric({
          compiled: aCompiled,
          metric,
          sessionPatternId: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          milestoneKey: effectiveMilestoneKey,
        }),
        b: measureDesignMetric({
          compiled: bCompiled,
          metric,
          sessionPatternId: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          milestoneKey: effectiveMilestoneKey,
        }),
      };
      designCache.set(metric, pair);
      return pair;
    };

    const seed = effectiveSeed;
    const runId =
      flags["run-id"] ??
      deriveDeterministicRunId({
        command: "compare",
        seed,
        scope: identity,
      });
    const outputMeta = buildOutputMeta({
      command: "compare",
      runId,
      seed,
      scenarioPath: [aPath, bPath],
      scenarios: {
        a: aScenario,
        b: bScenario,
      },
      pluginDigest: loaded.pluginDigest,
    });
    const singleResults = selectedMetrics.map((metric) => {
      const design = getDesignPair(metric);
      return buildSingleCompareOutput({
        metric,
        E,
        aScenario,
        bScenario,
        ma,
        mb,
        da: design?.a,
        db: design?.b,
        maxDuration: flags["max-duration"],
      });
    });
    const output =
      flags.bundle
        ? {
            bundle: flags.bundle,
            milestoneKey: effectiveMilestoneKey,
            results: singleResults,
            summary: {
              winners: {
                a: singleResults.filter((result) => result.better === "a").length,
                b: singleResults.filter((result) => result.better === "b").length,
                tie: singleResults.filter((result) => result.better === "tie").length,
              },
            },
          }
        : singleResults[0]!;

    if (flags["artifact-out"]) {
      const aAbs = resolve(process.cwd(), aPath);
      const bAbs = resolve(process.cwd(), bPath);
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "compare",
        positional: [aAbs, bAbs],
        flags,
        forcedFlags: {
          "run-id": runId,
          seed,
          format: "json",
        },
        result: output,
        meta: outputMeta,
      });
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
      meta: outputMeta,
    });
  },
});
