import { defineCommand, option } from "../runtime/command";
import {
  applyOfflineSeconds,
  constraintsWithAnchor,
  deserializeSimState,
  parseSimStateJSON,
  runElapsedSec,
  runScenario,
  serializeSimState,
  validateScenarioV1,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { buildOfflineSummary, eventLogStageInputs, resolveEventLog } from "./_shared/simulateView";
import {
  cliError,
  errorDetail,
  resumeStrategyMismatchError,
  scenarioInvalidError,
  usageError,
} from "../errors";
import { buildOutputMeta, deriveDeterministicRunId, hashContent } from "../io/outputMeta";
import { printNextSteps } from "../io/nextSteps";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { prepareResolvedRun } from "../lib/runConfiguration";
import { readJsonFile, writeTextFile } from "../runtime/bun";

const strategySchema = z.string().min(1).optional();

function assertValidScenario(valid: ReturnType<typeof validateScenarioV1>) {
  if (!valid.ok || !valid.scenario) {
    throw scenarioInvalidError(valid.issues);
  }
  return valid.scenario;
}

// Writers before the engine field only ran the number engine.
function assertResumeEngine(args: {
  engineId: string;
  resumedJson: ReturnType<typeof parseSimStateJSON> | undefined;
}) {
  if (!args.resumedJson) return;
  const saved = args.resumedJson.engine?.name ?? "number";
  if (saved !== args.engineId) {
    throw cliError("SIM_STATE_ENGINE_MISMATCH", `Resume engine mismatch: expected ${args.engineId}, got ${saved}`, {
      hint: `Pass --engine ${saved} to resume this state.`,
    });
  }
}

// Only what the run reads: deserializeSimState, the engine check, and restoreStrategyState.
// Save metadata does not change the economy. The saved elapsed clock enters the report digest separately.
function resumeHash(json: ReturnType<typeof parseSimStateJSON> | undefined): string | null {
  if (!json) return null;
  const { v, unit, t, wallet, maxMoneyEver, prestige, vars, strategy } = json;
  return hashContent({
    v,
    unit,
    t,
    wallet,
    maxMoneyEver,
    prestige,
    vars,
    engine: json.engine?.name ?? "number",
    strategy: strategy
      ? {
          id: strategy.id,
          ...(strategy.version !== undefined ? { version: strategy.version } : {}),
          ...(strategy.state !== undefined ? { state: strategy.state } : {}),
        }
      : null,
  });
}

function restoreStrategyState(args: {
  strategy: ReturnType<typeof prepareResolvedRun>["definition"]["strategy"];
  resumedJson: ReturnType<typeof parseSimStateJSON> | undefined;
}) {
  if (!args.resumedJson?.strategy) return;
  const resumed = args.resumedJson.strategy;
  const strategy = args.strategy;
  if (!strategy) {
    throw resumeStrategyMismatchError(`Resume state contains strategy '${resumed.id}' but scenario has no strategy`);
  }
  if (strategy.id !== resumed.id) {
    throw resumeStrategyMismatchError(`Resume strategy mismatch: expected ${strategy.id}, got ${resumed.id}`);
  }
  if (
    resumed.version !== undefined &&
    strategy.stateVersion !== undefined &&
    resumed.version !== strategy.stateVersion
  ) {
    throw resumeStrategyMismatchError(
      `Resume strategy state version mismatch: expected ${strategy.stateVersion}, got ${resumed.version}`,
    );
  }
  if (strategy.restoreState) {
    strategy.restoreState(resumed.state);
  } else if (resumed.state !== undefined) {
    throw resumeStrategyMismatchError(`Strategy '${strategy.id}' does not support state restore`);
  }
}

export default defineCommand({
  name: "simulate",
  description: "Run simulation with scenario",
  options: {
    ...pluginOptions(),
    duration: option(z.coerce.number().optional(), { description: "Override durationSec" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec" }),
    strategy: option(strategySchema, {
      description: "Registered strategy id. Builtins remain greedy, planner, and scripted.",
    }),
    engine: option(z.string().min(1).optional(), {
      description: "Execution engine. Default number. scenario.engine is metadata. breakInfinity is explicit. breakEternity is unsupported.",
    }),
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
      throw usageError(
        "Usage: idk simulate <scenario> [--duration <sec>] [--step <sec>] [--offline-seconds <sec>] [--resume <state.json>]",
      );
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const scenario = assertValidScenario(validateScenarioV1(input, loaded.modelRegistry));

    const resumedJson = flags.resume
      ? await readJsonFile<unknown>(resolve(process.cwd(), flags.resume))
          .then((raw) => {
            try {
              return parseSimStateJSON(raw);
            } catch (error) {
              throw cliError("SIM_STATE_INVALID_JSON", `Invalid resume state json: ${resolve(process.cwd(), flags.resume!)}`, {
                detail: errorDetail(error),
                cause: error,
              });
            }
          })
          .catch((error) => {
            if (error instanceof Error && error.name === "CliError") throw error;
            throw cliError("SIM_STATE_INVALID_JSON", `Invalid resume state json: ${resolve(process.cwd(), flags.resume!)}`, {
              detail: errorDetail(error),
              cause: error,
            });
          })
      : undefined;

    const resumeDigest = resumeHash(resumedJson);
    const unseeded = prepareResolvedRun({
      scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      pluginDigest: loaded.pluginDigest,
      engineRequest: flags.engine,
      strategyOverride: flags.strategy,
      stepSec: flags.step,
      fast: flags.fast,
    });
    assertResumeEngine({ engineId: unseeded.engine.effectiveId, resumedJson });
    const durationSec = unseeded.definition.run.durationSec;
    const stageInputs = {
      durationSec: flags.duration ?? durationSec,
      offlineSeconds: flags["offline-seconds"] ?? 0,
      resumeHash: resumeDigest,
    };
    const deterministicSeed =
      flags.seed ??
      unseeded.defaultSeed(
        // The seed input of a run without flags.
        {
          command: "simulate",
          scenario,
          resumeHash: null,
          options: {
            duration: scenario.clock.durationSec,
            step: scenario.clock.stepSec,
            strategy: scenario.strategy?.id,
            fast: false,
            offlineSeconds: 0,
          },
        },
        [
          {
            stage: "simulate",
            inputs: stageInputs,
            defaults: { durationSec, offlineSeconds: 0, resumeHash: null },
          },
        ],
      );
    const prepared = unseeded.withSeed(deterministicSeed);
    const eventLog = resolveEventLog({
      defaultEventLog: prepared.definition.run.eventLog,
      eventLogEnabled: flags["event-log-enabled"],
      eventLogMax: flags["event-log-max"],
    });
    const priorElapsedSec = resumedJson
      ? resumedJson.meta?.totalElapsedSec ?? resumedJson.t - prepared.definition.initial.t
      : 0;
    // Retention and the saved elapsed clock affect the report, not the simulation seed.
    const opened = prepared.open(
      "simulate",
      `simulate:${deterministicSeed}`,
      stageInputs,
      {
        ...eventLogStageInputs(prepared.definition.run.eventLog, eventLog),
        ...(resumedJson ? { priorElapsedSec } : {}),
      },
    );
    const runId =
      flags["run-id"] ??
      deriveDeterministicRunId({
        command: "simulate",
        seed: deterministicSeed,
        scope: { effectiveRunHash: opened.hash },
      });
    const E = prepared.engine.engine as typeof prepared.definition.ctx.E;
    const strategy = opened.scenario.strategy;
    restoreStrategyState({
      strategy,
      resumedJson,
    });
    const resumedState = resumedJson
      ? deserializeSimState<number, string, Record<string, unknown>>(E, resumedJson, {
          expectedUnit: opened.scenario.ctx.unit.code,
          unitFactory: (code) => ({ code }),
        })
      : undefined;
    const outputMeta = buildOutputMeta({
      command: "simulate",
      scenarioPath,
      scenario,
      runId,
      seed: deterministicSeed,
      pluginDigest: loaded.pluginDigest,
      effectiveRunHash: opened.hash,
      effectiveEngine: prepared.engine.effectiveId,
      stageScope: { simulate: opened.plan.stage.applies },
    });
    const generatedAt = outputMeta.generatedAt;

    let lastResetT: number | undefined;
    const runScenarioInput = {
      ...opened.scenario,
      initial: resumedState ?? opened.scenario.initial,
      strategy,
      run: {
        ...opened.scenario.run,
        durationSec: flags.duration ?? opened.scenario.run.durationSec,
        eventLog,
        onPrestigeReset(t: number) {
          lastResetT = t;
          opened.scenario.run.onPrestigeReset?.(t);
        },
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

    // The online run starts from a reset committed during offline catch-up.
    const effectiveScenario = offlineRun
      ? {
          ...runScenarioInput,
          initial: offlineRun.end,
          ...(lastResetT !== undefined
            ? { constraints: constraintsWithAnchor(runScenarioInput.constraints, lastResetT) }
            : {}),
        }
      : runScenarioInput;

    const run = runScenario(effectiveScenario);
    const netWorth = effectiveScenario.model.netWorth?.(effectiveScenario.ctx, run.end) ?? run.end.wallet.money;
    const totalElapsedSec = priorElapsedSec + (offlineRun ? runElapsedSec(offlineRun) : 0) + runElapsedSec(run);
    const stateOutPath = flags["state-out"] ? resolve(process.cwd(), flags["state-out"]) : undefined;
    const seed = deterministicSeed;
    const offlineEndWorth =
      offlineRun && (runScenarioInput.model.netWorth?.(runScenarioInput.ctx, offlineRun.end) ?? offlineRun.end.wallet.money);

    if (stateOutPath) {
      const strategyState = strategy?.snapshotState ? strategy.snapshotState() : undefined;
      const serialized = serializeSimState(E, run.end, {
        engineName: prepared.engine.effectiveId,
        engineVersion: "1",
        scenarioPath,
        savedAt: generatedAt,
        runId,
        seed,
        cliVersion: outputMeta.cliVersion,
        gitSha: outputMeta.gitSha,
        scenarioHash: typeof outputMeta.scenarioHash === "string" ? outputMeta.scenarioHash : undefined,
        totalElapsedSec,
        strategy: strategy
          ? {
              id: strategy.id,
              version: strategy.stateVersion,
              state: strategyState,
            }
          : undefined,
      });
      await writeTextFile(stateOutPath, `${JSON.stringify(serialized, null, 2)}\n`);
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
      durationSec: runElapsedSec(run),
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
    printNextSteps({
      format: flags.format,
      steps: [
        { label: "experience", command: `idk experience ${scenarioPath} --format md` },
        { label: "compare", command: `idk compare ${scenarioPath} <other-scenario> --metric endNetWorth --format json` },
        { label: "report", command: `idk report ${scenarioPath} --include-growth true --format md` },
      ],
    });
  },
});
