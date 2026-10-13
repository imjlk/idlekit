import { parseJudgeRubric, validateAnalysisArtifact, type AnalysisArtifactV1, type JudgeRubricV1 } from "@idlekit/core";

/**
 * Rubrics are data. This parser does not evaluate strings as code.
 */

export function readJudgeInputs(
  artifactRaw: unknown,
  rubricRaw: unknown,
): { ok: true; artifact: AnalysisArtifactV1; rubric: JudgeRubricV1 } | { ok: false; issues: readonly string[] } {
  const artifact = validateAnalysisArtifact(artifactRaw);
  const rubric = parseJudgeRubric(rubricRaw);
  const issues: string[] = [];
  if (!artifact.success) {
    issues.push(...artifact.errors.map((error) => `artifact ${error.path} ${error.expected}`));
  }
  if (!rubric.ok) issues.push(...rubric.issues);
  if (!artifact.success || !rubric.ok) return { ok: false, issues };
  return { ok: true, artifact: artifact.data, rubric: rubric.rubric };
}
