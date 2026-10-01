import { judgeArtifact, type JudgeReportV1 } from "@idlekit/core";
import type { AnalysisEvaluator, AnalysisEvaluatorInput } from "./types";

export function evaluateRules(input: AnalysisEvaluatorInput): JudgeReportV1 {
  const judged = judgeArtifact(input.artifact, input.rubric);
  if (!judged.ok) {
    throw new Error(judged.issues.join("; "));
  }
  return judged.report;
}

export const rulesEvaluator: AnalysisEvaluator = {
  provider: "rules",
  evaluate: evaluateRules,
};
