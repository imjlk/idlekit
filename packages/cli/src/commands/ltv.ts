import { defineCommand, option } from "@bunli/core";
import {
  compileScenario,
  createNumberEngine,
  runScenario,
  validateScenarioV1,
  type CompiledScenario,
  type ScenarioV1,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, unknownStrategyError, usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicRunId, deriveDeterministicSeed } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import {
  deriveMonetizationConfig,
  estimateLtvDistribution,
  estimateLtvPerUser,
  progressionFactor,
} from "../lib/ltvModel";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

type HorizonPoint = Readonly<{
  label: string;
  seconds: number;
}>;

function parseHorizonToken(raw: string): HorizonPoint {
  const token = raw.trim().toLowerCase();
  if (!token) throw cliError("CLI_USAGE", "horizon token cannot be empty");

  const unitMatch = token.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
  if (unitMatch) {
    const value = Number(unitMatch[1] ?? "");
    const unit = (unitMatch[2] ?? "").toLowerCase();
    if (!Number.isFinite(value) || value <= 0) {
      throw cliError("CLI_USAGE", `invalid horizon token: ${raw}`);
    }
    const seconds =
      unit === "s"
        ? value
        : unit === "m"
          ? value * 60
          : unit === "h"
            ? value * 3600
            : value * 86400;
    return { label: token, seconds };
  }

  const numeric = Number(token);
  if (Number.isFinite(numeric) && numeric > 0) {
    return { label: `${numeric}s`, seconds: numeric };
  }

  throw cliError("CLI_USAGE", `invalid horizon token: ${raw} (expected e.g. 30m,2h,24h,7d)`);
}

function parseHorizons(raw: string): HorizonPoint[] {
  const tokens = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw cliError("CLI_USAGE", "at least one horizon is required");
  }

  const map = new Map<number, HorizonPoint>();
  for (const token of tokens) {
    const p = parseHorizonToken(token);
    if (!map.has(p.seconds)) map.set(p.seconds, p);
  }
  return Array.from(map.values()).sort((a, b) => a.seconds - b.seconds);
}

function getSummaryBySeconds<T extends { seconds: number }>(rows: T[], seconds: number): T | undefined {
  return rows.find((r) => r.seconds === seconds);
}

type StatsCounts = {
  moneyApplied: number;
  moneyDropped: number;
  moneyQueued: number;
  moneyFlushed: number;
  moneyBlocked: number;
  actionsApplied: number;
  actionsSkippedCannot: number;
  actionsSkippedFunds: number;
};

function emptyCounts(): StatsCounts {
  return {
    moneyApplied: 0,
    moneyDropped: 0,
    moneyQueued: 0,
    moneyFlushed: 0,
    moneyBlocked: 0,
    actionsApplied: 0,
    actionsSkippedCannot: 0,
    actionsSkippedFunds: 0,
  };
}

function mergeCounts(base: StatsCounts, runStats: any): StatsCounts {
  if (!runStats) return base;
  return {
    moneyApplied: base.moneyApplied + Number(runStats.money?.applied ?? 0),
    moneyDropped: base.moneyDropped + Number(runStats.money?.dropped ?? 0),
    moneyQueued: base.moneyQueued + Number(runStats.money?.queued ?? 0),
    moneyFlushed: base.moneyFlushed + Number(runStats.money?.flushed ?? 0),
    moneyBlocked: base.moneyBlocked + Number(runStats.money?.blocked ?? 0),
    actionsApplied: base.actionsApplied + Number(runStats.actions?.applied ?? 0),
    actionsSkippedCannot: base.actionsSkippedCannot + Number(runStats.actions?.skippedCannotApply ?? 0),
    actionsSkippedFunds: base.actionsSkippedFunds + Number(runStats.actions?.skippedInsufficientFunds ?? 0),
  };
}

function buildGuardrailKpi(args: {
  counts: StatsCounts;
  actionCounts: Record<string, number>;
  firstUpgradeSec: number | null;
  growthLog10PerDay: number;
}): Readonly<{
  timeToFirstUpgradeSec: number | null;
  stallRatio: number;
  droppedRate: number;
  actionMix: Record<string, number>;
  growthLog10PerDay: number;
}> {
  const c = args.counts;
  const totalActionAttempts = c.actionsApplied + c.actionsSkippedCannot + c.actionsSkippedFunds;
  const stallRatio = totalActionAttempts > 0 ? c.actionsSkippedFunds / totalActionAttempts : 0;
  const totalMoneyEvents = c.moneyApplied + c.moneyDropped + c.moneyQueued;
  const droppedRate = totalMoneyEvents > 0 ? c.moneyDropped / totalMoneyEvents : 0;

  const totalApplied = Math.max(
    1,
    Object.values(args.actionCounts).reduce((a, b) => a + b, 0),
  );
  const actionMix: Record<string, number> = {};
  for (const [k, v] of Object.entries(args.actionCounts)) {
    actionMix[k] = v / totalApplied;
  }

  return {
    timeToFirstUpgradeSec: args.firstUpgradeSec,
    stallRatio,
    droppedRate,
    actionMix,
    growthLog10PerDay: args.growthLog10PerDay,
  };
}

export type LtvRow = Readonly<{
  horizon: string;
  seconds: number;
  segmentSec: number;
  endMoney: string;
  endNetWorth: string;
  deltaNetWorth: string;
  netWorthPerHour: string;
  deltaPerDay: string;
  economyValueProxy?: string;
  monetization: {
    cumulativeGrossRevenuePerUser: number;
    cumulativeNetRevenuePerUser: number;
    cumulativeLtvPerUser: number;
    cumulativeLtvQuantiles?: Record<string, number>;
  };
  guardrails: {
    timeToFirstUpgradeSec: number | null;
    stallRatio: number;
    droppedRate: number;
    actionMix: Record<string, number>;
    growthLog10PerDay: number;
  };
}>;

export type LtvAnalysisResult = Readonly<{
  monetization: {
    config: ReturnType<typeof deriveMonetizationConfig>;
    uncertainty: {
      enabled: boolean;
      draws: number;
      quantiles: readonly number[];
    };
  };
  horizons: readonly LtvRow[];
  summary: {
    at30m?: LtvRow;
    at2h?: LtvRow;
    at24h?: LtvRow;
    at7d?: LtvRow;
    at30d?: LtvRow;
    at90d?: LtvRow;
  };
  insights: {
    summary: string;
    trend7to90: string;
  };
  run: {
    id: string;
    seed: number;
    stepSec: number;
    fast: boolean;
    strategyId: string | null;
  };
}>;

export function runLtvAnalysis(args: {
  scenario: ScenarioV1;
  scenarioPath: string;
  compiled: CompiledScenario<number, string, Record<string, unknown>>;
  strategy: CompiledScenario<number, string, Record<string, unknown>>["strategy"];
  horizonsRaw: string;
  step?: number;
  fast: boolean;
  seed: number;
  draws?: number;
  valuePerWorth?: number;
  runId?: string;
}): LtvAnalysisResult {
  const horizons = parseHorizons(args.horizonsRaw);
  const stepSec = args.step ?? args.compiled.run.stepSec;
  const runFast = args.fast
    ? {
        enabled: true,
        kind: "log-domain" as const,
        disableMoneyEvents: true,
      }
    : args.compiled.run.fast;
  const monetizationConfig = deriveMonetizationConfig(args.scenario);
  const uncertainEnabled = monetizationConfig.uncertainty.enabled || args.draws !== undefined;
  const draws = args.draws ?? monetizationConfig.uncertainty.draws;

  let state = args.compiled.initial;
  let previousTargetSec = 0;
  let previousWorth = args.compiled.model.netWorth?.(args.compiled.ctx, args.compiled.initial) ?? args.compiled.initial.wallet.money;
  const startWorthLog10 = args.compiled.ctx.E.absLog10(previousWorth.amount);

  const actionCounts: Record<string, number> = {};
  let firstUpgradeSec: number | null = null;
  let counts = emptyCounts();

  const rows: LtvRow[] = [];

  for (const h of horizons) {
    const segmentSec = h.seconds - previousTargetSec;
    if (segmentSec <= 0) continue;

    const run = runScenario({
      ...args.compiled,
      initial: state,
      strategy: args.strategy,
      ctx: {
        ...args.compiled.ctx,
        seed: args.seed,
      },
      run: {
        ...args.compiled.run,
        stepSec,
        durationSec: segmentSec,
        until: undefined,
        trace: {
          everySteps: Number.MAX_SAFE_INTEGER,
          keepActionsLog: true,
        },
        eventLog: {
          enabled: false,
          maxEvents: 0,
        },
        fast: runFast,
      },
    });

    state = run.end;
    counts = mergeCounts(counts, run.stats);

    for (const log of run.actionsLog ?? []) {
      actionCounts[log.actionId] = (actionCounts[log.actionId] ?? 0) + 1;
      if (firstUpgradeSec === null && /upgrade/i.test(log.actionId)) {
        firstUpgradeSec = log.t;
      }
    }

    const worth = args.compiled.model.netWorth?.(args.compiled.ctx, state) ?? state.wallet.money;
    const endWorthLog10 = args.compiled.ctx.E.absLog10(worth.amount);
    const progression = progressionFactor(startWorthLog10, endWorthLog10, monetizationConfig.revenue.progressionLogSpan);
    const horizonDays = h.seconds / 86400;
    const point = estimateLtvPerUser({
      config: monetizationConfig,
      horizonDays,
      progression,
    });
    const distribution =
      uncertainEnabled && draws > 1
        ? estimateLtvDistribution({
            config: monetizationConfig,
            horizonDays,
            progression,
            draws,
            quantiles: monetizationConfig.uncertainty.quantiles,
            seed: (args.seed ?? monetizationConfig.uncertainty.seed ?? 1) + h.seconds,
          })
        : undefined;

    const E = args.compiled.ctx.E;
    const deltaWorth = E.sub(worth.amount, previousWorth.amount);
    const perHour = E.mul(E.div(worth.amount, Math.max(1, h.seconds)), 3600);
    const deltaPerDay = E.mul(E.div(deltaWorth, Math.max(1, segmentSec)), 86400);
    const growthLog10PerDay = (() => {
      const prevLog = E.absLog10(previousWorth.amount);
      const nextLog = E.absLog10(worth.amount);
      const days = Math.max(segmentSec / 86400, 1e-12);
      return (nextLog - prevLog) / days;
    })();
    const economyValueProxy =
      args.valuePerWorth !== undefined
        ? E.toString(E.mul(worth.amount, args.valuePerWorth))
        : undefined;

    rows.push({
      horizon: h.label,
      seconds: h.seconds,
      segmentSec,
      endMoney: E.toString(state.wallet.money.amount),
      endNetWorth: E.toString(worth.amount),
      deltaNetWorth: E.toString(deltaWorth),
      netWorthPerHour: E.toString(perHour),
      deltaPerDay: E.toString(deltaPerDay),
      economyValueProxy,
      monetization: {
        cumulativeGrossRevenuePerUser: distribution?.mean.cumulativeGrossRevenuePerUser ?? point.cumulativeGrossRevenuePerUser,
        cumulativeNetRevenuePerUser: distribution?.mean.cumulativeNetRevenuePerUser ?? point.cumulativeNetRevenuePerUser,
        cumulativeLtvPerUser: distribution?.mean.cumulativeLtvPerUser ?? point.cumulativeLtvPerUser,
        cumulativeLtvQuantiles: distribution?.quantiles,
      },
      guardrails: buildGuardrailKpi({
        counts,
        actionCounts,
        firstUpgradeSec,
        growthLog10PerDay,
      }),
    });

    previousWorth = worth;
    previousTargetSec = h.seconds;
  }

  const summary = {
    at30m: getSummaryBySeconds(rows, 1800),
    at2h: getSummaryBySeconds(rows, 7200),
    at24h: getSummaryBySeconds(rows, 86400),
    at7d: getSummaryBySeconds(rows, 604800),
    at30d: getSummaryBySeconds(rows, 2592000),
    at90d: getSummaryBySeconds(rows, 7776000),
  };

  const runId =
    args.runId ??
    deriveDeterministicRunId({
      command: "ltv",
      seed: args.seed,
      scope: {
        scenarioPath: resolve(process.cwd(), args.scenarioPath),
        horizons: horizons.map((x) => x.label),
        stepSec,
      },
    });

  const trend7to90 = (() => {
    const at7d = summary.at7d;
    const at90d = summary.at90d;
    if (!at7d || !at90d) return "insufficient_horizon_data";
    const n7 = Number(at7d.monetization.cumulativeLtvPerUser);
    const n90 = Number(at90d.monetization.cumulativeLtvPerUser);
    if (!Number.isFinite(n7) || !Number.isFinite(n90)) return "insufficient_horizon_data";
    if (n90 > n7 * 1.2) return "long_tail_growth";
    if (n90 < n7 * 1.02) return "late_game_flattening";
    return "steady_growth";
  })();

  return {
    monetization: {
      config: monetizationConfig,
      uncertainty: {
        enabled: uncertainEnabled,
        draws: uncertainEnabled ? draws : 0,
        quantiles: monetizationConfig.uncertainty.quantiles,
      },
    },
    horizons: rows,
    summary,
    insights: {
      summary: `LTV trajectory classification: ${trend7to90}`,
      trend7to90,
    },
    run: {
      id: runId,
      seed: args.seed,
      stepSec,
      fast: !!runFast?.enabled,
      strategyId: args.strategy?.id ?? null,
    },
  };
}

export default defineCommand({
  name: "ltv",
  description: "Compute long-horizon LTV snapshots (30m..90d) and uncertainty bands",
  options: {
    ...pluginOptions(),
    horizons: option(z.string().default("30m,2h,24h,7d,30d,90d"), {
      description: "Comma-separated duration tokens (s|m|h|d)",
    }),
    step: option(z.coerce.number().positive().optional(), {
      description: "Override stepSec for long-horizon runs",
    }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), {
      description: "Enable fast(log-domain) mode for long horizons",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed passed to ctx.seed" }),
    "value-per-worth": option(z.coerce.number().nonnegative().optional(), {
      description: "Optional conversion factor from netWorth to business value",
    }),
    draws: option(z.coerce.number().int().positive().optional(), {
      description: "Monte Carlo draws override (uses scenario.monetization.uncertainty.draws by default)",
    }),
    "run-id": option(z.string().optional(), {
      description: "Optional run identifier used in output metadata",
    }),
    "artifact-out": option(z.string().optional(), { description: "Write replay artifact JSON to path" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk ltv <scenario> [--horizons 30m,2h,24h,7d,30d,90d]");
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw scenarioInvalidError(valid.issues);
    }

    const E = createNumberEngine();
    const compiled = compileScenario<number, string, Record<string, unknown>>({
      E,
      scenario: valid.scenario,
      registry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      opts: { allowSuffixNotation: true },
    });

    const strategy = (() => {
      if (!flags.strategy) return compiled.strategy;
      const f = loaded.strategyRegistry.get(flags.strategy);
      if (!f) throw unknownStrategyError(flags.strategy);
      return f.create(f.defaultParams ?? {}) as typeof compiled.strategy;
    })();

    const baseSeed =
      flags.seed ??
      deriveDeterministicSeed({
        command: "ltv",
        scenario: valid.scenario,
        options: {
          horizons: flags.horizons,
          step: flags.step ?? compiled.run.stepSec,
          strategy: flags.strategy,
          fast: flags.fast,
          draws: flags.draws,
          valuePerWorth: flags["value-per-worth"],
        },
      });

    const seed = baseSeed;
    const analysis = runLtvAnalysis({
      scenario: valid.scenario,
      scenarioPath,
      compiled,
      strategy,
      horizonsRaw: flags.horizons,
      step: flags.step,
      fast: flags.fast,
      seed,
      draws: flags.draws,
      valuePerWorth: flags["value-per-worth"],
      runId: flags["run-id"],
    });
    const outputMeta = buildOutputMeta({
      command: "ltv",
      runId: analysis.run.id,
      scenarioPath,
      scenario: valid.scenario,
      seed,
      pluginDigest: loaded.pluginDigest,
    });
    const jsonOutput = {
      scenario: scenarioPath,
      run: analysis.run,
      monetization: analysis.monetization,
      horizons: analysis.horizons,
      summary: analysis.summary,
      insights: analysis.insights,
    };
    const output = flags.format === "json" ? jsonOutput : analysis.horizons;

    if (flags["artifact-out"]) {
      const scenarioAbs = resolve(process.cwd(), scenarioPath);
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "ltv",
        positional: [scenarioAbs],
        flags,
        forcedFlags: {
          "run-id": analysis.run.id,
          seed,
          format: "json",
        },
        result: jsonOutput,
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
