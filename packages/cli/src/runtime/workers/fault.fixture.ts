// Fault controls exist only in this test entry; the production trial ignores these payload fields.
import { loadRegistries } from "../../plugin/load";
import { runAnalysisTrial } from "./trial";
import { workerEntryMarker } from "./entry";
import type { AnalysisTrialTaskV1 } from "@idlekit/core";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
};
scope.onmessage = (event: MessageEvent) => {
  const message = event.data as { type?: string; task?: AnalysisTrialTaskV1 };
  if (message.type !== "run" || !message.task) return;
  const task = message.task;
  const fault = (task.payload as { testFault?: string } | null)?.testFault;
  if (fault === "crash") process.exit(1);
  if (fault === "hang") return;
  void runAnalysisTrial(task, loadRegistries).then((outcome) => {
    scope.postMessage({ type: "outcome", marker: workerEntryMarker, outcome });
  });
};
