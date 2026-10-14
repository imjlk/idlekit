import { runWorkerPool, workerEntryUrl } from "./runtime/workers/pool";
import { defaultExecutionBudget, type AnalysisTrialTaskV1 } from "@idlekit/core";

const plugins = JSON.parse(process.argv[2] ?? "{}") as Partial<Pick<AnalysisTrialTaskV1, "pluginPaths" | "pluginRoots" | "pluginDigests">>;
const task: AnalysisTrialTaskV1 = {
  schemaVersion: 1, contract: "idlekit.execution-task.v1", taskId: "packaged", logicalIndex: 0,
  seed: 19, stepBudget: 1000, kind: "analysis-trial",
  payload: { stepSec: 1, durationSec: 3, incomePerSec: "1" },
  pluginPaths: [], pluginRoots: [], pluginDigests: {}, ...plugins,
};
const batch = await runWorkerPool({ tasks: [task], workers: 1, budget: { ...defaultExecutionBudget, maxWorkers: 1, maxRetries: 1, taskTimeoutMs: 10_000 } });
console.log(JSON.stringify({ entry: workerEntryUrl().href, batch }));
