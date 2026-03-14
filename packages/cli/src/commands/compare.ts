import { defineCommand, option } from "@bunli/core";
import {
  compareScenarios,
  compileScenario,
  createNumberEngine,
  deepClonePreservingPrototype,
  parseMoney,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { betterFromCmp, formatEtaLabel, toComparableEta } from "./_shared/compareEval";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import {
  collectExperienceSnapshot,
  comparableExperienceMetric,
  resolveExperienceQuantiles,
  resolveExperienceSeries,
  resolveSessionPatternId,
  resolveSessionPatternSpec,
  summarizeComparableExperienceMetric,
} from "../lib/experience";
import { scenarioInvalidError, unknownStrategyError, usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicRunId, deriveDeterministicSeed } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

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
  scenario: any;
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
  const compiled = compileScenario<number, string, Record<string, unknown>>({
    E: args.E,
    scenario: args.scenario,
    registry: args.loaded.modelRegistry,
    strategyRegistry: args.loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });

  const overrideStrategy = (() => {
    if (!args.flags.strategy) return compiled.strategy;
    const factory = args.loaded.strategyRegistry.get(args.flags.strategy);
    if (!factory) throw unknownStrategyError(args.flags.strategy);
    return factory.create(factory.defaultParams ?? {}) as typeof compiled.strategy;
  })();

  return {
    ...compiled,
    ctx: {
      ...compiled.ctx,
      seed: args.flags.seed ?? compiled.ctx.seed,
    },
    strategy: overrideStrategy,
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
}

function measureScenario(args: {
  compiled: ReturnType<typeof compileComparableScenario>;
  E: ReturnType<typeof createNumberEngine>;
  targetWorth?: string;
  maxDuration: number;
}) {
  const runInput = {
    ...args.compiled,
    initial: deepClonePreservingPrototype(args.compiled.initial),
  };
  const run = runScenario(runInput);
  const endWorth = runInput.model.netWorth?.(runInput.ctx, run.end) ?? run.end.wallet.money;

  let etaSeconds: number | undefined;
  let etaReached: boolean | undefined;
  if (args.targetWorth) {
    const target = parseMoney(args.E, args.targetWorth, {
      unit: runInput.ctx.unit,
      suffix: { kind: "alphaInfinite", minLen: 2 },
    }).amount;

    const reachedFn = (s: typeof run.end) =>
      args.E.cmp((runInput.model.netWorth?.(runInput.ctx, s) ?? s.wallet.money).amount, target) >= 0;

    const etaRun = runScenario({
      ...runInput,
      initial: deepClonePreservingPrototype(args.compiled.initial),
      run: {
        ...runInput.run,
        durationSec: args.maxDuration,
        trace: undefined,
        until: reachedFn,
      },
    });

    etaReached = reachedFn(etaRun.end);
    etaSeconds = etaReached ? etaRun.end.t - etaRun.start.t : Number.POSITIVE_INFINITY;
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
  const sessionPattern = resolveSessionPatternSpec({
    scenario: args.compiled,
    sessionPatternId: resolveSessionPatternId(args.sessionPatternId),
    days: args.days,
  });
  const series = resolveExperienceSeries(args.compiled);
  const draws = Math.max(1, Math.floor(args.draws ?? args.compiled.analysis?.experience?.draws ?? 1));
  const quantiles = resolveExperienceQuantiles(args.compiled);
  const fallback = sessionPattern.days * 86400 + 1;

  const deterministic = collectExperienceSnapshot({
    scenario: args.compiled,
    sessionPattern,
    seed: args.compiled.ctx.seed,
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
    scenario: args.compiled,
    sessionPattern,
    metric: args.metric,
    milestoneKey: args.milestoneKey,
    draws,
    seed: args.compiled.ctx.seed ?? 1,
    quantiles,
    series,
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
  metric: string;
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
    metric: option(
      z
        .enum([
          "endMoney",
          "endNetWorth",
          "etaToTargetWorth",
          "droppedRate",
          "timeToMilestone",
          "visibleChangesPerMinute",
          "maxNoRewardGapSec",
        ])
        .default("endNetWorth"),
      { description: "Comparison metric" },
    ),
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

    if (flags.metric === "etaToTargetWorth" && !flags["target-worth"]) {
      throw usageError("metric=etaToTargetWorth requires --target-worth <NumStr>");
    }
    if (flags.metric === "timeToMilestone" && !flags["milestone-key"]) {
      throw usageError("metric=timeToMilestone requires --milestone-key <key>");
    }

    const effectiveSeed =
      flags.seed ??
      deriveDeterministicSeed({
        command: "compare",
        scenarios: {
          a: aScenario,
          b: bScenario,
        },
        options: {
          metric: flags.metric,
          duration: flags.duration,
          step: flags.step,
          strategy: flags.strategy,
          fast: flags.fast,
          targetWorth: flags["target-worth"],
          maxDuration: flags["max-duration"],
          sessionPattern: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          milestoneKey: flags["milestone-key"],
        },
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

    const isDesignMetric =
      flags.metric === "timeToMilestone" ||
      flags.metric === "visibleChangesPerMinute" ||
      flags.metric === "maxNoRewardGapSec";

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
    const da = isDesignMetric
      ? measureDesignMetric({
          compiled: aCompiled,
          metric: flags.metric as "timeToMilestone" | "visibleChangesPerMinute" | "maxNoRewardGapSec",
          sessionPatternId: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          milestoneKey: flags["milestone-key"],
        })
      : undefined;
    const db = isDesignMetric
      ? measureDesignMetric({
          compiled: bCompiled,
          metric: flags.metric as "timeToMilestone" | "visibleChangesPerMinute" | "maxNoRewardGapSec",
          sessionPatternId: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          milestoneKey: flags["milestone-key"],
        })
      : undefined;

    const result = compareScenarios({
      a: aScenario,
      b: bScenario,
      metric: flags.metric,
      measured: {
        a: {
          endMoney: E.absLog10(ma.endMoney),
          endNetWorth: E.absLog10(ma.endNetWorth),
          droppedRate: ma.droppedRate,
          etaToTargetWorth: toComparableEta(ma.etaToTargetWorth, flags["max-duration"]),
          ...measuredDesignFields(flags.metric, da),
        },
        b: {
          endMoney: E.absLog10(mb.endMoney),
          endNetWorth: E.absLog10(mb.endNetWorth),
          droppedRate: mb.droppedRate,
          etaToTargetWorth: toComparableEta(mb.etaToTargetWorth, flags["max-duration"]),
          ...measuredDesignFields(flags.metric, db),
        },
      },
      measuredDecision: (metric) => {
        switch (metric) {
          case "endMoney":
            return betterFromCmp(E.cmp(ma.endMoney, mb.endMoney));
          case "endNetWorth":
            return betterFromCmp(E.cmp(ma.endNetWorth, mb.endNetWorth));
          case "droppedRate":
            return betterFromCmp(ma.droppedRate < mb.droppedRate ? 1 : ma.droppedRate > mb.droppedRate ? -1 : 0);
          case "etaToTargetWorth": {
            const aEta = toComparableEta(ma.etaToTargetWorth, flags["max-duration"]);
            const bEta = toComparableEta(mb.etaToTargetWorth, flags["max-duration"]);
            if (aEta === undefined || bEta === undefined) return undefined;
            return betterFromCmp(aEta < bEta ? 1 : aEta > bEta ? -1 : 0);
          }
          case "timeToMilestone":
          case "maxNoRewardGapSec": {
            if (da?.value === undefined || db?.value === undefined) return undefined;
            return betterFromCmp(da.value < db.value ? 1 : da.value > db.value ? -1 : 0);
          }
          case "visibleChangesPerMinute": {
            if (da?.value === undefined || db?.value === undefined) return undefined;
            return betterFromCmp(da.value > db.value ? 1 : da.value < db.value ? -1 : 0);
          }
          default:
            return undefined;
        }
      },
    });

    const seed = effectiveSeed;
    const runId =
      flags["run-id"] ??
      deriveDeterministicRunId({
        command: "compare",
        seed,
        scope: {
          aPath: resolve(process.cwd(), aPath),
          bPath: resolve(process.cwd(), bPath),
          metric: flags.metric,
        },
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
    const output = {
      metric: flags.metric,
      better: result.better,
      detail: result.detail,
      measured: {
        a: {
          endMoney: E.toString(ma.endMoney),
          endNetWorth: E.toString(ma.endNetWorth),
          droppedRate: ma.droppedRate,
          etaToTargetWorth:
            ma.etaToTargetWorth === undefined
              ? undefined
              : formatEtaLabel(ma.etaToTargetWorth, !!ma.etaReached),
          ...measuredDesignFields(flags.metric, da),
        },
        b: {
          endMoney: E.toString(mb.endMoney),
          endNetWorth: E.toString(mb.endNetWorth),
          droppedRate: mb.droppedRate,
          etaToTargetWorth:
            mb.etaToTargetWorth === undefined
              ? undefined
              : formatEtaLabel(mb.etaToTargetWorth, !!mb.etaReached),
          ...measuredDesignFields(flags.metric, db),
        },
      },
      insights: buildCompareInsights({
        metric: flags.metric,
        endNetWorthWinner: betterFromCmp(E.cmp(ma.endNetWorth, mb.endNetWorth)),
        better: result.better,
        a: {
          endNetWorth: E.toString(ma.endNetWorth),
          droppedRate: ma.droppedRate,
          etaToTargetWorth:
            ma.etaToTargetWorth === undefined
              ? undefined
              : formatEtaLabel(ma.etaToTargetWorth, !!ma.etaReached),
          ...measuredDesignFields(flags.metric, da),
        },
        b: {
          endNetWorth: E.toString(mb.endNetWorth),
          droppedRate: mb.droppedRate,
          etaToTargetWorth:
            mb.etaToTargetWorth === undefined
              ? undefined
              : formatEtaLabel(mb.etaToTargetWorth, !!mb.etaReached),
          ...measuredDesignFields(flags.metric, db),
        },
      }),
    };

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
