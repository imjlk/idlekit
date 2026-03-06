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
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { buildOfflineSummary, resolveEventLog } from "./_shared/simulateView";
import { buildOutputMeta, deriveDeterministicRunId, deriveDeterministicSeed, hashContent } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

function assertValidScenario(valid: ReturnType<typeof validateScenarioV1>) {
  if (!valid.ok || !valid.scenario) {
    throw new Error(
      `Scenario invalid: ${valid.issues.map((i) => `${i.path ?? "root"}: ${i.message}`).join("; ")}`,
    );
  }
  return valid.scenario;
}

function resolveStrategy(args: {
  compiled: ReturnType<typeof compileScenario<number, string, Record<string, unknown>>>;
  overrideId?: z.infer<typeof strategySchema>;
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>;
}) {
  if (!args.overrideId) return args.compiled.strategy;
  const factory = args.loaded.strategyRegistry.get(args.overrideId);
  if (!factory) throw new Error(`Unknown strategy: ${args.overrideId}`);
  const params = factory.defaultParams ?? {};
  return factory.create(params) as typeof args.compiled.strategy;
}

function restoreStrategyState(args: {
  strategy: ReturnType<typeof resolveStrategy>;
  resumedJson: ReturnType<typeof parseSimStateJSON> | undefined;
}) {
  if (!args.resumedJson?.strategy) return;
  const resumed = args.resumedJson.strategy;
  const strategy = args.strategy;
  if (!strategy) {
    throw new Error(`Resume state contains strategy '${resumed.id}' but scenario has no strategy`);
  }
  if (strategy.id !== resumed.id) {
    throw new Error(`Resume strategy mismatch: expected ${strategy.id}, got ${resumed.id}`);
  }
  if (
    resumed.version !== undefined &&
    strategy.stateVersion !== undefined &&
    resumed.version !== strategy.stateVersion
  ) {
    throw new Error(
      `Resume strategy state version mismatch: expected ${strategy.stateVersion}, got ${resumed.version}`,
    );
  }
  if (strategy.restoreState) {
    strategy.restoreState(resumed.state);
  } else if (resumed.state !== undefined) {
    throw new Error(`Strategy '${strategy.id}' does not support state restore`);
  }
}

export default defineCommand({
  name: "simulate",
  description: "Run simulation with scenario",
  options: {
    ...pluginOptions(),
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
    "artifact-out": option(z.string().optional(), { description: "Write replay artifact JSON to path" }),
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
    const loaded = await loadRegistriesFromFlags(flags);
    const scenario = assertValidScenario(validateScenarioV1(input, loaded.modelRegistry));

    const E = createNumberEngine();
    const compiled = compileScenario<number, string, Record<string, unknown>>({
      E,
      scenario,
      registry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      opts: { allowSuffixNotation: true },
    });

    const resumedJson = flags.resume
      ? parseSimStateJSON(JSON.parse(await readFile(resolve(process.cwd(), flags.resume), "utf8")))
      : undefined;

    const strategy = resolveStrategy({
      compiled,
      overrideId: flags.strategy,
      loaded,
    });
    restoreStrategyState({
      strategy,
      resumedJson,
    });

    const eventLog = resolveEventLog({
      defaultEventLog: compiled.run.eventLog,
      eventLogEnabled: flags["event-log-enabled"],
      eventLogMax: flags["event-log-max"],
    });

    const resumedState = resumedJson
      ? deserializeSimState<number, string, Record<string, unknown>>(E, resumedJson, {
          expectedUnit: compiled.ctx.unit.code,
          unitFactory: (code) => ({ code }),
        })
      : undefined;

    const deterministicSeed =
      flags.seed ??
      deriveDeterministicSeed({
        command: "simulate",
        scenario,
        scenarioPath: resolve(process.cwd(), scenarioPath),
        resumeHash: resumedJson ? hashContent(resumedJson) : null,
        options: {
          duration: flags.duration ?? compiled.run.durationSec,
          step: flags.step ?? compiled.run.stepSec,
          strategy: flags.strategy ?? strategy?.id,
          fast: flags.fast,
          offlineSeconds: flags["offline-seconds"] ?? 0,
        },
      });
    const runId =
      flags["run-id"] ??
      deriveDeterministicRunId({
        command: "simulate",
        seed: deterministicSeed,
        scope: {
          scenarioPath: resolve(process.cwd(), scenarioPath),
          resumeHash: resumedJson ? hashContent(resumedJson) : null,
          strategyId: strategy?.id,
        },
      });
    const outputMeta = buildOutputMeta({
      command: "simulate",
      scenarioPath,
      scenario,
      runId,
      seed: deterministicSeed,
      pluginDigest: loaded.pluginDigest,
    });
    const generatedAt = outputMeta.generatedAt;

    const runScenarioInput = {
      ...compiled,
      initial: resumedState ?? compiled.initial,
      ctx: {
        ...compiled.ctx,
        seed: deterministicSeed,
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
    const seed = deterministicSeed;
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
              version: strategy.stateVersion,
              state: strategyState,
            }
          : undefined,
      });
      await writeFile(stateOutPath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
    }

    const offlineSummary = buildOfflineSummary(offlineRun);

    const output = {
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
    };

    if (flags["artifact-out"]) {
      const scenarioAbs = resolve(process.cwd(), scenarioPath);
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "simulate",
        positional: [scenarioAbs],
        flags,
        forcedFlags: {
          seed,
          "run-id": runId,
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
