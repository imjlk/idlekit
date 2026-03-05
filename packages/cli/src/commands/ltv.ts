import { defineCommand, option } from "@bunli/core";
import { compileScenario, createNumberEngine, runScenario, validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import {
  deriveMonetizationConfig,
  estimateLtvDistribution,
  estimateLtvPerUser,
  progressionFactor,
} from "../lib/ltvModel";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

type HorizonPoint = Readonly<{
  label: string;
  seconds: number;
}>;

function parseHorizonToken(raw: string): HorizonPoint {
  const token = raw.trim().toLowerCase();
  if (!token) throw new Error("horizon token cannot be empty");

  const unitMatch = token.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
  if (unitMatch) {
    const value = Number(unitMatch[1] ?? "");
    const unit = (unitMatch[2] ?? "").toLowerCase();
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid horizon token: ${raw}`);
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

  throw new Error(`invalid horizon token: ${raw} (expected e.g. 30m,2h,24h,7d)`);
}

function parseHorizons(raw: string): HorizonPoint[] {
  const tokens = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("at least one horizon is required");
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
}): Readonly<{
  timeToFirstUpgradeSec: number | null;
  stallRatio: number;
  droppedRate: number;
  actionMix: Record<string, number>;
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
  };
}

export default defineCommand({
  name: "ltv",
  description: "Compute long-horizon LTV snapshots (30m..90d) and uncertainty bands",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    "plugin-root": option(z.string().default(""), {
      description: "Comma-separated allowed plugin root directories",
    }),
    "plugin-sha256": option(z.string().default(""), {
      description: "Comma-separated '<path>=<sha256>' plugin integrity map",
    }),
    "plugin-trust-file": option(z.string().default(""), {
      description: "Plugin trust policy json file path",
    }),
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
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk ltv <scenario> [--horizons 30m,2h,24h,7d,30d,90d]");
    }

    const horizons = parseHorizons(flags.horizons);
    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
        trustFile: flags["plugin-trust-file"],
      }),
    );
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw new Error(
        `Scenario invalid: ${valid.issues.map((i) => `${i.path ?? "root"}: ${i.message}`).join("; ")}`,
      );
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
      if (!f) throw new Error(`Unknown strategy: ${flags.strategy}`);
      return f.create(f.defaultParams ?? {}) as typeof compiled.strategy;
    })();

    const stepSec = flags.step ?? compiled.run.stepSec;
    const runFast = flags.fast
      ? {
          enabled: true,
          kind: "log-domain" as const,
          disableMoneyEvents: true,
        }
      : compiled.run.fast;

    const monetizationConfig = deriveMonetizationConfig(valid.scenario);
    const uncertainEnabled = monetizationConfig.uncertainty.enabled || flags.draws !== undefined;
    const draws = flags.draws ?? monetizationConfig.uncertainty.draws;

    let state = compiled.initial;
    let previousTargetSec = 0;
    let previousWorth = compiled.model.netWorth?.(compiled.ctx, compiled.initial) ?? compiled.initial.wallet.money;
    const startWorthLog10 = E.absLog10(previousWorth.amount);

    const actionCounts: Record<string, number> = {};
    let firstUpgradeSec: number | null = null;
    let counts = emptyCounts();

    const rows: Array<{
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
      };
    }> = [];

    for (const h of horizons) {
      const segmentSec = h.seconds - previousTargetSec;
      if (segmentSec <= 0) continue;

      const run = runScenario({
        ...compiled,
        initial: state,
        strategy,
        ctx: {
          ...compiled.ctx,
          seed: flags.seed ?? compiled.ctx.seed,
        },
        run: {
          ...compiled.run,
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

      const worth = compiled.model.netWorth?.(compiled.ctx, state) ?? state.wallet.money;
      const endWorthLog10 = E.absLog10(worth.amount);
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
              seed: (flags.seed ?? monetizationConfig.uncertainty.seed ?? 1) + h.seconds,
            })
          : undefined;

      const deltaWorth = E.sub(worth.amount, previousWorth.amount);
      const perHour = E.mul(E.div(worth.amount, Math.max(1, h.seconds)), 3600);
      const deltaPerDay = E.mul(E.div(deltaWorth, Math.max(1, segmentSec)), 86400);
      const economyValueProxy =
        flags["value-per-worth"] !== undefined
          ? E.toString(E.mul(worth.amount, flags["value-per-worth"]))
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

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data:
        flags.format === "json"
          ? {
              scenario: scenarioPath,
              run: {
                stepSec,
                fast: !!runFast?.enabled,
                strategyId: strategy?.id ?? null,
              },
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
            }
          : rows,
      meta: buildOutputMeta({
        command: "ltv",
        scenarioPath,
        scenario: valid.scenario,
        seed: flags.seed ?? compiled.ctx.seed,
      }),
    });
  },
});
