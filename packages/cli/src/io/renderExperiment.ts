import type { ExperimentArtifactV1 } from "@idlekit/core";
import { experimentDecisionHints, renderDecisionHints, type ExperimentHintInput } from "../lib/decisionHints";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "n/a";
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function code(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}

/** Markdown report for `idk experiment --format md`. The full artifact stays in a JSON appendix. */
export function renderExperimentMarkdown(
  artifact: ExperimentArtifactV1,
  objectives: ExperimentHintInput["objectives"] = [],
): string {
  const metricIds = [...new Set(artifact.candidates.flatMap((candidate) => candidate.metrics.map((metric) => metric.metricId)))];
  const lines = [
    "# Experiment Report",
    "",
    `- Scenario: ${code(artifact.scenario.ref)}`,
    `- Method: ${artifact.method} (local, one at a time; not a global or Sobol index)`,
    `- Candidates / seeds: ${artifact.budget.usedCandidates} / ${artifact.budget.usedSeeds}`,
    ...(artifact.milestoneKey ? [`- Milestone key: ${code(artifact.milestoneKey)}`] : []),
    "",
    "## Candidates",
    "",
    `| Candidate | ${metricIds.map(cell).join(" | ")} | Constraint violations | Pareto |`,
    `| --- | ${metricIds.map(() => "---").join(" | ")} | --- | --- |`,
    ...artifact.candidates.map((candidate) => {
      const values = metricIds.map((metricId) => {
        const metric = candidate.metrics.find((entry) => entry.metricId === metricId);
        if (!metric) return "n/a";
        return metric.status === "observed" ? cell(metric.value) : `${cell(metric.value)} (${metric.status})`;
      });
      const pareto = artifact.pareto.nonDominated.includes(candidate.id)
        ? "non-dominated"
        : artifact.pareto.uncompared.includes(candidate.id) ? "uncompared" : "dominated";
      return `| ${code(candidate.id)} | ${values.join(" | ")} | ${candidate.constraintViolations.length ? candidate.constraintViolations.map(cell).join(", ") : "none"} | ${pareto} |`;
    }),
    "",
    "## Local sensitivity",
    "",
    ...(artifact.elasticities.length > 0
      ? [
          "| Dimension | Probe | Metric | Elasticity | Absolute change | Direction |",
          "| --- | --- | --- | --- | --- | --- |",
          ...artifact.elasticities.map((row) =>
            `| ${code(row.dimensionId)} | ${code(row.candidateId)} | ${cell(row.metricId)} | ${row.status === "observed" ? cell(row.elasticity) : `n/a (${row.status})`} | ${cell(row.absoluteChange)} | ${row.direction} |`),
          "",
          "- Elasticity is the relative metric change divided by the relative parameter change between the baseline and one probe. `--chart-out` draws the same table as a heatmap.",
        ]
      : ["- No probe produced an elasticity row (no baseline candidate or no probes)."]),
    "",
    ...renderDecisionHints(experimentDecisionHints({ ...artifact, objectives }), {
      verify: "Confirm a chosen lever with a matched `idk compare` of the baseline and the adjusted scenario.",
    }),
    ...(artifact.warnings.length ? ["", "## Warnings", "", ...artifact.warnings.map((warning) => `- ${cell(warning)}`)] : []),
    "",
    "## Artifact",
    "",
    "<details><summary>Full experiment artifact (JSON)</summary>",
    "",
    "```json",
    JSON.stringify(artifact, null, 2),
    "```",
    "",
    "</details>",
  ];
  return `${lines.join("\n")}\n`;
}
