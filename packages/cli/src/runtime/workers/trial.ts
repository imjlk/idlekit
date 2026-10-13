import {
  builtinStrategyFactories,
  compileScenario,
  createModelRegistry,
  createRunFactory,
  createStrategyRegistry,
  runScenario,
  semanticDigest,
  serializeSimState,
  type AnalysisTrialOutcomeV1,
  type AnalysisTrialTaskV1,
  type Engine,
  type ModelRegistry,
  type ScenarioV1,
  type StrategyRegistry,
} from "@idlekit/core";
import { resolveEffectiveEngine } from "../../lib/runConfiguration";
import { createLinearFactory } from "../../plugin/linearModel";

export type TrialRegistries = Readonly<{ modelRegistry: ModelRegistry; strategyRegistry: StrategyRegistry }>;

/** The plugin loader a trial with plugin paths needs. The worker entry passes the CLI loader. */
export type TrialPluginLoader = (
  pluginPaths: string[],
  policy: Readonly<{ allowedRoots: string[]; requiredSha256: Record<string, string> }>,
) => Promise<TrialRegistries>;

/** The built-in registries the plugin loader starts from. A trial without plugin paths needs nothing else. */
function builtinRegistries(): TrialRegistries {
  return {
    modelRegistry: createModelRegistry([createLinearFactory()]),
    strategyRegistry: createStrategyRegistry([...builtinStrategyFactories]),
  };
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity Plugin roots and digests are the parent policy. An empty root list does not allow every file.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #2e1b075 Re-read the section: a path outside the parent roots fails closed, the worker does not add a root, plugin-trust is a loader refusal, and a step-budget stop is incomplete.
 */
export const trialPluginBoundary = "plugin-policy-not-widened" as const;

type TrialPayload = Readonly<{
  engineId?: string;
  stepSec?: number;
  durationSec?: number;
  incomePerSec?: string;
  initialAmount?: string;
  fault?: "crash" | "hang";
}>;

function payloadOf(task: AnalysisTrialTaskV1): TrialPayload {
  const payload = task.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as TrialPayload;
}

export function analysisTrialScenario(task: AnalysisTrialTaskV1): ScenarioV1 {
  const payload = payloadOf(task);
  const params = {
    incomePerSec: payload.incomePerSec ?? "1",
    buyCostBase: "1000000000",
    buyCostGrowth: 1.15,
    buyIncomeDelta: "0",
  };
  return {
    schemaVersion: 1,
    meta: { id: task.taskId, title: task.taskId },
    unit: { code: "COIN" },
    policy: { mode: "accumulate" },
    model: { id: "linear", version: 1, params },
    initial: {
      t: 0,
      wallet: { unit: "COIN", amount: payload.initialAmount ?? "0", bucket: "0" },
      vars: { owned: 0 },
      prestige: { count: 0, points: "0", multiplier: "1" },
    },
    clock: {
      stepSec: payload.stepSec ?? 1,
      durationSec: payload.durationSec ?? 4,
    },
    strategy: {
      id: "scripted",
      params: { schemaVersion: 1, program: [], onCannotApply: "skip", loop: true },
    },
  };
}

function failed(task: AnalysisTrialTaskV1, reason: string): AnalysisTrialOutcomeV1 {
  return {
    taskId: task.taskId,
    logicalIndex: task.logicalIndex,
    seed: task.seed,
    status: "failed",
    reason,
    attempts: 1,
    semanticDigest: null,
    endMoney: null,
  };
}

export async function runAnalysisTrial(
  task: AnalysisTrialTaskV1,
  loadPlugins?: TrialPluginLoader,
): Promise<AnalysisTrialOutcomeV1> {
  const payload = payloadOf(task);
  if (payload.fault === "crash") process.exit(1);
  if (payload.fault === "hang") await new Promise(() => {});
  if (task.pluginPaths.length > 0 && task.pluginRoots.length === 0) return failed(task, "plugin-trust");
  // Plugin paths without a loader fail closed. They are never skipped onto the built-ins.
  if (task.pluginPaths.length > 0 && !loadPlugins) return failed(task, "plugin-trust");
  /*
   * The trust decision is where the plugins load, not what an error message says. A loader
   * refusal is plugin-trust and is not retried. Anything thrown after the plugins are admitted
   * is an ordinary trial failure and may retry, whatever its message mentions.
   */
  let loaded: TrialRegistries;
  try {
    loaded =
      task.pluginPaths.length > 0 && loadPlugins
        ? await loadPlugins([...task.pluginPaths], {
            allowedRoots: [...task.pluginRoots],
            requiredSha256: { ...task.pluginDigests },
          })
        : builtinRegistries();
  } catch {
    return failed(task, "plugin-trust");
  }
  try {
    const resolved = resolveEffectiveEngine({ requested: payload.engineId ?? "number" });
    const scenario = analysisTrialScenario(task);
    const engine = resolved.engine as Engine<number>;
    const compiled = compileScenario({
      E: engine,
      scenario,
      registry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      unitFactory: (code) => ({ code: code as "COIN" }),
    });
    const binding = createRunFactory({
      models: loaded.modelRegistry,
      strategies: loaded.strategyRegistry,
    }).bind(compiled, {
      statefulModel: true,
      statefulStrategy: true,
      model: { id: "linear", version: 1, params: scenario.model.params },
      strategy: { id: "scripted", params: scenario.strategy?.params },
    });
    try {
      const opened = binding.fresh({ trialId: task.taskId, seed: task.seed });
      const executed = runScenario({
        ...opened.scenario,
        run: { ...opened.scenario.run, maxSteps: task.stepBudget },
      });
      // The step budget stopped the run before the requested horizon. That state is not the trial's end.
      if (executed.stop?.reason === "budget") {
        return { ...failed(task, "step-budget"), status: "incomplete" };
      }
      const end = serializeSimState(engine, executed.end, {
        engineName: resolved.effectiveId,
        seed: task.seed,
        runId: task.taskId,
      });
      return {
        taskId: task.taskId,
        logicalIndex: task.logicalIndex,
        seed: task.seed,
        status: "ok",
        reason: "ok",
        attempts: 1,
        semanticDigest: semanticDigest({
          taskId: task.taskId,
          logicalIndex: task.logicalIndex,
          seed: task.seed,
          end,
        }),
        endMoney: end.wallet.amount,
      };
    } finally {
      binding.release();
    }
  } catch {
    return failed(task, "trial-failed");
  }
}
