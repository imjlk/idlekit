import { defineCommand, option } from "@bunli/core";
import {
  applyOfflineSeconds,
  compileScenario,
  createNumberEngine,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

export default defineCommand({
  name: "simulate",
  description: "Run simulation with scenario",
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
    strategy: option(strategySchema, { description: "greedy|planner|scripted" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast(log-domain) mode" }),
    "event-log-enabled": option(z.coerce.boolean().optional(), {
      description: "Override event log retention enabled flag",
    }),
    "event-log-max": option(z.coerce.number().int().nonnegative().optional(), {
      description: "Retain only latest N events in memory",
    }),
    "offline-seconds": option(z.coerce.number().nonnegative().optional(), {
      description: "Apply offline catch-up before simulation starts",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error(
        "Usage: idk simulate <scenario> [--duration <sec>] [--step <sec>] [--offline-seconds <sec>]",
      );
    }

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

    const strategyId = flags.strategy ?? valid.scenario.strategy?.id;
    const strategy = (() => {
      if (!strategyId) return compiled.strategy;
      const factory = loaded.strategyRegistry.get(strategyId);
      if (!factory) throw new Error(`Unknown strategy: ${strategyId}`);
      const params = factory.defaultParams ?? {};
      return factory.create(params) as typeof compiled.strategy;
    })();

    const eventLog =
      flags["event-log-enabled"] !== undefined || flags["event-log-max"] !== undefined
        ? {
            enabled: flags["event-log-enabled"] ?? compiled.run.eventLog?.enabled,
            maxEvents: flags["event-log-max"] ?? compiled.run.eventLog?.maxEvents,
          }
        : compiled.run.eventLog;

    const runScenarioInput = {
      ...compiled,
      strategy,
      run: {
        ...compiled.run,
        stepSec: flags.step ?? compiled.run.stepSec,
        durationSec: flags.duration ?? compiled.run.durationSec,
        fast: flags.fast
          ? {
              enabled: true,
              kind: "log-domain" as const,
              disableMoneyEvents: true,
            }
          : compiled.run.fast,
        eventLog,
      },
    };

    const offlineSeconds = flags["offline-seconds"] ?? 0;
    const offlineRun =
      offlineSeconds > 0
        ? applyOfflineSeconds({
            scenario: runScenarioInput,
            seconds: offlineSeconds,
            options: {
              useStrategy: !!strategy,
              fast: runScenarioInput.run.fast,
              // Offline catch-up does not need to retain all events by default.
              eventLog: {
                enabled: false,
                maxEvents: 0,
              },
            },
          })
        : undefined;

    const effectiveScenario = offlineRun
      ? {
          ...runScenarioInput,
          initial: offlineRun.end,
        }
      : runScenarioInput;

    const run = runScenario(effectiveScenario);
    const netWorth = effectiveScenario.model.netWorth?.(effectiveScenario.ctx, run.end) ?? run.end.wallet.money;
    const totalElapsedSec = run.end.t - compiled.initial.t;
    const offlineEndWorth =
      offlineRun && (runScenarioInput.model.netWorth?.(runScenarioInput.ctx, offlineRun.end) ?? offlineRun.end.wallet.money);

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: {
        scenario: scenarioPath,
        startT: run.start.t,
        endT: run.end.t,
        durationSec: run.end.t - run.start.t,
        totalElapsedSec,
        endMoney: E.toString(run.end.wallet.money.amount),
        endNetWorth: E.toString(netWorth.amount),
        offline:
          offlineRun &&
          ({
            requestedSec: offlineRun.offline.requestedSec,
            simulatedSec: offlineRun.offline.simulatedSec,
            stepSec: offlineRun.offline.stepSec,
            fullSteps: offlineRun.offline.fullSteps,
            remainderSec: offlineRun.offline.remainderSec,
            usedStrategy: offlineRun.offline.usedStrategy,
            endT: offlineRun.end.t,
            endMoney: E.toString(offlineRun.end.wallet.money.amount),
            endNetWorth: offlineEndWorth ? E.toString(offlineEndWorth.amount) : undefined,
            stats: offlineRun.stats,
            uxFlags: offlineRun.uxFlags,
          }),
        prestige: {
          count: run.end.prestige.count,
          points: E.toString(run.end.prestige.points),
          multiplier: E.toString(run.end.prestige.multiplier),
        },
        stats: run.stats,
        uxFlags: run.uxFlags,
        eventLog: run.eventLog,
      },
    });
  },
});
