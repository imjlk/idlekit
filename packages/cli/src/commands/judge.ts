import { defineCommand, option } from "../runtime/command";
import type { JudgeReportV1 } from "@idlekit/core";
import { z } from "zod";
import { usageError } from "../errors";
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

/** One CSV row per rubric rule: the numerical result beside its semantic diagnostic. */
function judgeCsvRows(report: JudgeReportV1): Array<Record<string, string | number | null>> {
  return report.numerical.results.map((result, index) => {
    const diagnostic = report.diagnostics[index];
    return {
      id: result.id,
      metricId: result.metricId,
      verdict: result.verdict,
      severity: result.severity,
      evidenceStatus: result.evidence.status,
      value: result.evidence.value,
      unit: result.evidence.unit,
      operator: result.evidence.operator,
      threshold: result.evidence.threshold,
      upperThreshold: result.evidence.upperThreshold,
      diagnosticStatus: diagnostic?.status ?? null,
      recommendationId: diagnostic?.recommendationId ?? null,
    };
  });
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
  // An unreadable or non-JSON input is a usage error, like a structurally invalid one.
  let artifactRaw: unknown;
  let rubricRaw: unknown;
  try {
    artifactRaw = await readJsonFile<unknown>(analysisPath);
    rubricRaw = await readJsonFile<unknown>(flags.rubric);
  } catch (error) {
    throw usageError(`Invalid judge input: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  // JSON output is exactly idlekit.judge.v1, whose root rejects extra keys, so no `_meta` is attached.
  // Markdown and CSV go through writeOutput too, so --out applies to every format.
  // CSV is one row per rule, not the nested report squeezed into one cell.
  await writeOutput({
    format: flags.format,
    outPath: flags.out,
    data:
      flags.format === "md" ? renderJudgeMarkdown(report) : flags.format === "csv" ? judgeCsvRows(report) : report,
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
