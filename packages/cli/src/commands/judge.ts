import { defineCommand, option } from "../runtime/command";
import type { JevAdvisoryV1, JudgeReportV1 } from "@idlekit/core";
import { z } from "zod";
import { usageError } from "../errors";
import { buildOutputMeta, outputSchemaRefForCommand } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { resolve } from "path";
import { readJsonFile } from "../runtime/bun";
import { readJudgeInputs } from "../lib/evaluation/input";
import { evaluateRules } from "../lib/evaluation/rules";
// Type only. main.ts registers this command for every invocation, so the opt-in provider loads after --provider jev.
import type { JevTransport } from "../lib/evaluation/providers/jev";

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

export type JevJudgeBundle = Readonly<{
  numericalReport: JudgeReportV1;
  advisory: JevAdvisoryV1;
}>;

export async function runJudge(flags: {
  rubric: string;
  provider: "rules" | "jev";
  out?: string;
  format: "json" | "md" | "csv";
  "dry-run"?: boolean;
  model?: string;
  cache?: string;
}, analysisPath: string, hooks?: {
  transport?: JevTransport;
  env?: Readonly<Record<string, string | undefined>>;
  nowMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<JudgeReportV1 | JevJudgeBundle> {
  // The Jev bundle is two nested reports. A one-column CSV cannot hold it, so the format is refused up front.
  if (flags.provider === "jev" && flags.format === "csv") {
    throw usageError("--provider jev writes json or md. csv cannot hold the rules report and the advisory together.");
  }
  // The output write would replace the cache it just stored, and the next run would pay for the request again.
  if (flags.provider === "jev" && flags.cache && flags.out && resolve(flags.cache) === resolve(flags.out)) {
    throw usageError("--cache and --out name the same file. Give the Jev cache its own path.");
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
  if (flags.provider === "rules") {
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
  const { adviseWithJev } = await import("../lib/evaluation/providers/jev");
  const advisory = await adviseWithJev({
    artifact: parsed.artifact,
    rubric: parsed.rubric,
    numerical: report,
    requestedModel: flags.model ?? "jev-latest",
    dryRun: flags["dry-run"] === true,
    cachePath: flags.cache,
    transport: hooks?.transport,
    env: hooks?.env,
    nowMs: hooks?.nowMs,
    sleep: hooks?.sleep,
  });
  const bundle: JevJudgeBundle = { numericalReport: report, advisory };
  if (flags.format === "md") {
    console.log(renderJudgeMarkdown(report));
    console.log(`- Jev: ${advisory.status} ${advisory.reason}`);
    // The plan is what a dry run is for, so md shows it as json does.
    console.log(`- Endpoint: ${advisory.endpoint}`);
    console.log(`- Planned requests: ${advisory.plannedRequests}`);
    return bundle;
  }
  await writeOutput({
    format: flags.format,
    outPath: flags.out,
    data: bundle,
    meta: buildOutputMeta({
      command: "judge",
      pluginDigest: {},
      // The bundle carries the rules report and the advisory side by side, so it has its own schema.
      schemaRef: outputSchemaRefForCommand("judge.jev"),
    }),
  });
  return bundle;
}

export default defineCommand({
  name: "judge",
  description: "Advise on an analysis artifact with a versioned rules rubric",
  options: {
    rubric: option(z.string(), { description: "Versioned rubric JSON path" }),
    provider: option(z.enum(["rules", "jev"]).default("rules"), {
      description: "Advisory provider. rules is local. jev is an opt-in network provider.",
    }),
    "dry-run": option(z.coerce.boolean().default(false), {
      description: "Show the Jev request plan without calling the network",
    }),
    model: option(z.string().default("jev-latest"), {
      description: "Requested Jev model. jev-latest is an alias, not a pinned id.",
    }),
    cache: option(z.string().optional(), { description: "Optional Jev advisory cache path" }),
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
