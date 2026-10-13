import { loadRegistries } from "../../plugin/load";
import { runAnalysisTrial } from "./trial";
import type { AnalysisTrialTaskV1 } from "@idlekit/core";

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity The packed worker entry is this module. It does not read a preload switch.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #2e1b075 Re-read the section: the marker is idlekit-worker-entry and the handler does not branch on a preload variable.
 */
export const workerEntryMarker = "idlekit-worker-entry" as const;

type WorkerScope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown) => void;
  Bun?: { isMainThread?: boolean };
};

const scope = globalThis as unknown as WorkerScope;

if (scope.Bun?.isMainThread === false) {
  scope.onmessage = (event: MessageEvent) => {
    const message = event.data as { type?: string; task?: AnalysisTrialTaskV1 };
    if (message?.type !== "run" || !message.task) return;
    void runAnalysisTrial(message.task, loadRegistries)
      .then((outcome) => {
        scope.postMessage({ type: "outcome", marker: workerEntryMarker, outcome });
      })
      .catch(() => {
        scope.postMessage({
          type: "outcome",
          marker: workerEntryMarker,
          outcome: {
            taskId: message.task?.taskId ?? "",
            logicalIndex: message.task?.logicalIndex ?? 0,
            seed: message.task?.seed ?? 0,
            status: "failed",
            reason: "worker-crash",
            attempts: 1,
            semanticDigest: null,
            endMoney: null,
          },
        });
      });
  };
}
