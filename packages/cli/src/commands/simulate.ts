import { defineCommand, option } from "@bunli/core";
import {
  applyOfflineSeconds,
  compileScenario,
  createNumberEngine,
  deserializeSimState,
  parseSimStateJSON,
  runScenario,
  serializeSimState,
  validateScenarioV1,
} from "@idlekit/core";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
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
    "plugin-trust-file": option(z.string().default(""), {
      description: "Plugin trust policy json file path",
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
    resume: option(z.string().optional(), { description: "Resume simulation from saved state json" }),
    "state-out": option(z.string().optional(), { description: "Write end simulation state json" }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed passed to ctx.seed" }),
    "run-id": option(z.string().optional(), { description: "Optional run identifier (auto-generated if omitted)" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error(
        "Usage: idk simulate <scenario> [--duration <sec>] [--step <sec>] [--offline-seconds <sec>] [--resume <state.json>]",
      );
    }

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

    const resumedJson = flags.resume
      ? parseSimStateJSON(JSON.parse(await readFile(resolve(process.cwd(), flags.resume), "utf8")))
      : undefined;

    const strategy = (() => {
      // Without explicit override, keep the strategy compiled from scenario params/defaults.
      if (!flags.strategy) return compiled.strategy;
      const factory = loaded.strategyRegistry.get(flags.strategy);
      if (!factory) throw new Error(`Unknown strategy: ${flags.strategy}`);
      const params = factory.defaultParams ?? {};
      return factory.create(params) as typeof compiled.strategy;
    })();

    if (resumedJson?.strategy) {
      if (!strategy) {
        throw new Error(`Resume state contains strategy '${resumedJson.strategy.id}' but scenario has no strategy`);
      }
      if (strategy.id !== resumedJson.strategy.id) {
        throw new Error(`Resume strategy mismatch: expected ${strategy.id}, got ${resumedJson.strategy.id}`);
      }
      if (strategy.restoreState) {
        strategy.restoreState(resumedJson.strategy.state);
      } else if (resumedJson.strategy.state !== undefined) {
        throw new Error(`Strategy '${strategy.id}' does not support state restore`);
      }
    }

    const eventLog =
      flags["event-log-enabled"] !== undefined || flags["event-log-max"] !== undefined
        ? {
            enabled: flags["event-log-enabled"] ?? compiled.run.eventLog?.enabled,
            maxEvents: flags["event-log-max"] ?? compiled.run.eventLog?.maxEvents,
          }
        : compiled.run.eventLog;

    const resumedState = resumedJson
      ? deserializeSimState<number, string, Record<string, unknown>>(E, resumedJson, {
          expectedUnit: compiled.ctx.unit.code,
          unitFactory: (code) => ({ code }),
        })
      : undefined;

    const runScenarioInput = {
      ...compiled,
      initial: resumedState ?? compiled.initial,
      ctx: {
        ...compiled.ctx,
        seed: flags.seed ?? compiled.ctx.seed,
      },
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
              policy: runScenarioInput.run.offline,
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
    const stateOutPath = flags["state-out"] ? resolve(process.cwd(), flags["state-out"]) : undefined;
    const runId = flags["run-id"] ?? randomUUID();
    const seed = effectiveScenario.ctx.seed;
    const generatedAt = new Date().toISOString();
    const outputMeta = buildOutputMeta({
      command: "simulate",
      scenarioPath,
      scenario: valid.scenario,
      runId,
      seed,
    });
    const offlineEndWorth =
      offlineRun && (runScenarioInput.model.netWorth?.(runScenarioInput.ctx, offlineRun.end) ?? offlineRun.end.wallet.money);

    if (stateOutPath) {
      const strategyState = strategy?.snapshotState ? strategy.snapshotState() : undefined;
      const serialized = serializeSimState(E, run.end, {
        engineName: "number",
        engineVersion: "1",
        scenarioPath,
        savedAt: generatedAt,
        runId,
        seed,
        cliVersion: outputMeta.cliVersion,
        gitSha: outputMeta.gitSha,
        scenarioHash: typeof outputMeta.scenarioHash === "string" ? outputMeta.scenarioHash : undefined,
        strategy: strategy
          ? {
              id: strategy.id,
              state: strategyState,
            }
          : undefined,
      });
      await writeFile(stateOutPath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
    }

    const offlineSummary =
      offlineRun &&
      ({
        requestedSec: offlineRun.offline.requestedSec,
        preDecaySec: offlineRun.offline.preDecaySec,
        effectiveSec: offlineRun.offline.effectiveSec,
        simulatedSec: offlineRun.offline.simulatedSec,
        stepSec: offlineRun.offline.stepSec,
        fullSteps: offlineRun.offline.fullSteps,
        remainderSec: offlineRun.offline.remainderSec,
        usedStrategy: offlineRun.offline.usedStrategy,
        overflow: offlineRun.offline.overflow,
        decay: offlineRun.offline.decay,
      });

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: {
        run: {
          id: runId,
          seed,
          generatedAt,
        },
        scenario: scenarioPath,
        startT: run.start.t,
        endT: run.end.t,
        durationSec: run.end.t - run.start.t,
        totalElapsedSec,
        resumedFrom: flags.resume,
        stateOut: stateOutPath,
        endMoney: E.toString(run.end.wallet.money.amount),
        endNetWorth: E.toString(netWorth.amount),
        offline:
          offlineRun &&
          ({
            ...offlineSummary,
            endT: offlineRun.end.t,
            endMoney: E.toString(offlineRun.end.wallet.money.amount),
            endNetWorth: offlineEndWorth ? E.toString(offlineEndWorth.amount) : undefined,
            stats: offlineRun.stats,
            uxFlags: offlineRun.uxFlags,
          }),
        summaries: {
          eventLog: run.eventLog,
          offline: offlineSummary,
        },
        prestige: {
          count: run.end.prestige.count,
          points: E.toString(run.end.prestige.points),
          multiplier: E.toString(run.end.prestige.multiplier),
        },
        stats: run.stats,
        uxFlags: run.uxFlags,
        eventLog: run.eventLog,
      },
      meta: outputMeta,
    });
  },
});
