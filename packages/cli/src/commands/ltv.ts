import { defineCommand, option } from "@bunli/core";
import { compileScenario, createNumberEngine, runScenario, validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
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
    // dedupe by seconds (keep first label)
    if (!map.has(p.seconds)) map.set(p.seconds, p);
  }
  return Array.from(map.values()).sort((a, b) => a.seconds - b.seconds);
}

function getSummaryBySeconds<T extends { seconds: number }>(rows: T[], seconds: number): T | undefined {
  return rows.find((r) => r.seconds === seconds);
}

export default defineCommand({
  name: "ltv",
  description: "Compute long-horizon KPI snapshots for LTV conversion",
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

    let state = compiled.initial;
    let previousTargetSec = 0;
    let previousWorth = compiled.model.netWorth?.(compiled.ctx, compiled.initial) ?? compiled.initial.wallet.money;

    const rows: Array<{
      horizon: string;
      seconds: number;
      segmentSec: number;
      endMoney: string;
      endNetWorth: string;
      deltaNetWorth: string;
      netWorthPerHour: string;
      deltaPerDay: string;
      ltvProxy?: string;
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
          trace: undefined,
          eventLog: {
            enabled: false,
            maxEvents: 0,
          },
          fast: runFast,
        },
      });

      state = run.end;
      const worth = compiled.model.netWorth?.(compiled.ctx, state) ?? state.wallet.money;
      const deltaWorth = E.sub(worth.amount, previousWorth.amount);
      const perHour = E.mul(E.div(worth.amount, Math.max(1, h.seconds)), 3600);
      const deltaPerDay = E.mul(E.div(deltaWorth, Math.max(1, segmentSec)), 86400);
      const ltvProxy =
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
        ltvProxy,
      });

      previousWorth = worth;
      previousTargetSec = h.seconds;
    }

    const jsonData = {
      scenario: scenarioPath,
      run: {
        stepSec,
        fast: !!runFast?.enabled,
        strategyId: strategy?.id ?? null,
        valuePerWorth: flags["value-per-worth"],
      },
      horizons: rows,
      summary: {
        at30m: getSummaryBySeconds(rows, 1800),
        at2h: getSummaryBySeconds(rows, 7200),
        at24h: getSummaryBySeconds(rows, 86400),
        at7d: getSummaryBySeconds(rows, 604800),
        at30d: getSummaryBySeconds(rows, 2592000),
        at90d: getSummaryBySeconds(rows, 7776000),
      },
    };

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: flags.format === "json" ? jsonData : rows,
    });
  },
});
