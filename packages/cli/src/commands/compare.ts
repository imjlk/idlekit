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
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

function formatEtaLabel(seconds: number, reached: boolean): string {
  if (!reached) return "unreached";
  return Number.isFinite(seconds) ? `${seconds}` : "unreached";
}

function etaPenalty(maxDuration: number): number {
  return maxDuration + 1_000_000_000;
}

function betterFromCmp(cmp: -1 | 0 | 1): "a" | "b" | "tie" {
  if (cmp === 0) return "tie";
  return cmp > 0 ? "a" : "b";
}

export default defineCommand({
  name: "compare",
  description: "Compare two scenarios via measured simulation metrics",
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
    duration: option(z.coerce.number().optional(), { description: "Override durationSec" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec" }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast(log-domain) mode" }),
    "target-worth": option(z.string().optional(), {
      description: "Required for etaToTargetWorth metric, optional otherwise",
    }),
    "max-duration": option(z.coerce.number().default(86400), {
      description: "Max duration for etaToTargetWorth metric simulation",
    }),
    metric: option(
      z.enum(["endMoney", "endNetWorth", "etaToTargetWorth", "droppedRate"]).default("endNetWorth"),
      { description: "Comparison metric" },
    ),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const aPath = positional[0];
    const bPath = positional[1];
    if (!aPath || !bPath) {
      throw new Error(
        "Usage: idk compare <A> <B> [--metric ...] [--plugin ...] [--target-worth <NumStr>]",
      );
    }

    const [aInput, bInput] = await Promise.all([readScenarioFile(aPath), readScenarioFile(bPath)]);
    const loaded = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
      }),
    );

    const va = validateScenarioV1(aInput, loaded.modelRegistry);
    const vb = validateScenarioV1(bInput, loaded.modelRegistry);

    if (!va.ok || !va.scenario) {
      throw new Error(`Scenario A invalid: ${va.issues.map((i) => i.message).join("; ")}`);
    }
    if (!vb.ok || !vb.scenario) {
      throw new Error(`Scenario B invalid: ${vb.issues.map((i) => i.message).join("; ")}`);
    }

    if (flags.metric === "etaToTargetWorth" && !flags["target-worth"]) {
      throw new Error("metric=etaToTargetWorth requires --target-worth <NumStr>");
    }

    const E = createNumberEngine();

    const compileOne = (scenario: typeof va.scenario) => {
      const compiled = compileScenario<number, string, Record<string, unknown>>({
        E,
        scenario,
        registry: loaded.modelRegistry,
        strategyRegistry: loaded.strategyRegistry,
        opts: { allowSuffixNotation: true },
      });

      const overrideStrategyId = flags.strategy;
      const overrideStrategy = (() => {
        if (!overrideStrategyId) return compiled.strategy;
        const factory = loaded.strategyRegistry.get(overrideStrategyId);
        if (!factory) throw new Error(`Unknown strategy: ${overrideStrategyId}`);
        return factory.create(factory.defaultParams ?? {}) as typeof compiled.strategy;
      })();

      return {
        ...compiled,
        strategy: overrideStrategy,
        run: {
          ...compiled.run,
          eventLog: {
            enabled: false,
            maxEvents: 0,
          },
          stepSec: flags.step ?? compiled.run.stepSec,
          durationSec: flags.duration ?? compiled.run.durationSec,
          fast: flags.fast
            ? { enabled: true as const, kind: "log-domain" as const, disableMoneyEvents: true }
            : compiled.run.fast,
        },
      };
    };

    const aCompiled = compileOne(va.scenario);
    const bCompiled = compileOne(vb.scenario);

    const measure = (compiled: typeof aCompiled) => {
      const runInput = {
        ...compiled,
        initial: deepClonePreservingPrototype(compiled.initial),
      };
      const run = runScenario(runInput);
      const endWorth = runInput.model.netWorth?.(runInput.ctx, run.end) ?? run.end.wallet.money;

      let etaSeconds: number | undefined;
      let etaReached: boolean | undefined;
      if (flags["target-worth"]) {
        const target = parseMoney(E, flags["target-worth"], {
          unit: runInput.ctx.unit,
          suffix: { kind: "alphaInfinite", minLen: 2 },
        }).amount;

        const reachedFn = (s: typeof run.end) =>
          E.cmp((runInput.model.netWorth?.(runInput.ctx, s) ?? s.wallet.money).amount, target) >= 0;

        const etaRun = runScenario({
          ...runInput,
          initial: deepClonePreservingPrototype(compiled.initial),
          run: {
            ...runInput.run,
            durationSec: flags["max-duration"],
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
    };

    const ma = measure(aCompiled);
    const mb = measure(bCompiled);

    const result = compareScenarios({
      a: va.scenario,
      b: vb.scenario,
      metric: flags.metric,
      measured: {
        a: {
          endMoney: E.absLog10(ma.endMoney),
          endNetWorth: E.absLog10(ma.endNetWorth),
          droppedRate: ma.droppedRate,
          etaToTargetWorth:
            ma.etaToTargetWorth === undefined
              ? undefined
              : (Number.isFinite(ma.etaToTargetWorth) ? ma.etaToTargetWorth : etaPenalty(flags["max-duration"])),
        },
        b: {
          endMoney: E.absLog10(mb.endMoney),
          endNetWorth: E.absLog10(mb.endNetWorth),
          droppedRate: mb.droppedRate,
          etaToTargetWorth:
            mb.etaToTargetWorth === undefined
              ? undefined
              : (Number.isFinite(mb.etaToTargetWorth) ? mb.etaToTargetWorth : etaPenalty(flags["max-duration"])),
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
            const aEta = ma.etaToTargetWorth === undefined
              ? undefined
              : (Number.isFinite(ma.etaToTargetWorth) ? ma.etaToTargetWorth : etaPenalty(flags["max-duration"]));
            const bEta = mb.etaToTargetWorth === undefined
              ? undefined
              : (Number.isFinite(mb.etaToTargetWorth) ? mb.etaToTargetWorth : etaPenalty(flags["max-duration"]));
            if (aEta === undefined || bEta === undefined) return undefined;
            return betterFromCmp(aEta < bEta ? 1 : aEta > bEta ? -1 : 0);
          }
          default:
            return undefined;
        }
      },
    });

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: {
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
          },
          b: {
            endMoney: E.toString(mb.endMoney),
            endNetWorth: E.toString(mb.endNetWorth),
            droppedRate: mb.droppedRate,
            etaToTargetWorth:
              mb.etaToTargetWorth === undefined
                ? undefined
                : formatEtaLabel(mb.etaToTargetWorth, !!mb.etaReached),
          },
        },
      },
    });
  },
});
