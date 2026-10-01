import type { AnalysisArtifactV1, JudgeReportV1, JudgeRubricV1 } from "@idlekit/core";

/**
 * CLI-local evaluator. The only provider is rules.
 * This interface has no vendor response type.
 */

export type RulesProviderName = "rules";

export type AnalysisEvaluatorInput = Readonly<{
  artifact: AnalysisArtifactV1;
  rubric: JudgeRubricV1;
}>;

export type AnalysisEvaluator = Readonly<{
  provider: RulesProviderName;
  evaluate(input: AnalysisEvaluatorInput): JudgeReportV1;
}>;
