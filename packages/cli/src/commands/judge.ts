import { defineCommand, option } from "../runtime/command";
import type { JudgeReportV1 } from "@idlekit/core";
import { z } from "zod";
import { usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { readJsonFile } from "../runtime/bun";
import { readJudgeInputs } from "../lib/evaluation/input";
import { evaluateRules } from "../lib/evaluation/rules";

function renderJudgeMarkdown(report: JudgeReportV1): string {
  const lines = [
    "# Rules judge",
    "",
    "This is not doctor. The numerical verdict is not rewritten.",
    "",
    `- Provider: ${report.provider}`,
    `- Rubric: ${report.rubricVersion}`,
    `- Digest: ${report.advisoryDigest}`,
    "",
    "## Numerical",
    "",
  ];
  for (const result of report.numerical.results) {
    lines.push(`- ${result.metricId}: ${result.verdict} ${result.evidence.value ?? "none"} ${result.evidence.unit}`);
  }
  lines.push("", "## Estimates", "");
  if (report.estimatedObservations.length === 0) lines.push("None.");
  for (const estimate of report.estimatedObservations) {
    lines.push(`- ${estimate.metricId}: ${estimate.value ?? "none"}`);
  }
  lines.push("", "## Semantic", "");
  for (const diagnostic of report.diagnostics) {
    lines.push(`- ${diagnostic.status} ${diagnostic.recommendationId}: ${diagnostic.text.en}`);
  }
  return lines.join("\n");
}

export async function runJudge(flags: {
  rubric: string;
  provider: "rules";
  out?: string;
  format: "json" | "md" | "csv";
}, analysisPath: string): Promise<JudgeReportV1> {
  if (flags.provider !== "rules") {
    throw usageError("--provider must be rules");
  }
  const artifactRaw = await readJsonFile<unknown>(analysisPath);
  const rubricRaw = await readJsonFile<unknown>(flags.rubric);
  const parsed = readJudgeInputs(artifactRaw, rubricRaw);
  if (!parsed.ok) {
    throw usageError(`Invalid judge input: ${parsed.issues.join("; ")}`);
  }
  let report: JudgeReportV1;
  try {
    report = evaluateRules(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw usageError(`Invalid judge input: ${message}`);
  }
  if (flags.format === "md") {
    console.log(renderJudgeMarkdown(report));
    return report;
  }
  await writeOutput({
    format: flags.format,
    outPath: flags.out,
    data: report,
    meta: buildOutputMeta({ command: "judge", pluginDigest: {} }),
  });
  return report;
}

export default defineCommand({
  name: "judge",
  description: "Advise on an analysis artifact with a versioned rules rubric",
  options: {
    rubric: option(z.string(), { description: "Versioned rubric JSON path" }),
    provider: option(z.enum(["rules"]).default("rules"), {
      description: "Advisory provider. The only built-in provider is rules.",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const analysisPath = positional[0];
    if (!analysisPath) {
      throw usageError("Usage: idk judge <analysis.json> --rubric <rubric.json> --provider rules");
    }
    await runJudge(flags, analysisPath);
  },
});
