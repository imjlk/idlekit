import { defineCommand, option } from "../runtime/command";
import type { JevAdvisoryV1, JudgeReportV1 } from "@idlekit/core";
import { z } from "zod";
import { usageError } from "../errors";
import { buildOutputMeta, outputSchemaRefForCommand } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { realpathSync, statSync } from "fs";
import { basename, dirname, resolve } from "path";
import { readJsonFile, writeTextFile } from "../runtime/bun";
import { readJudgeInputs } from "../lib/evaluation/input";
import { evaluateRules } from "../lib/evaluation/rules";
// Type only. main.ts registers this command for every invocation, so the opt-in provider loads after --provider jev.
import type { JevTransport } from "../lib/evaluation/providers/jev";

/**
 * Two paths name the same file when their text resolves alike, or when both exist and share a realpath or a
 * device and inode, so a symlink or a hard link to an input counts too.
 */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    // A file that does not exist yet is named by its nearest existing parent's realpath, so a symlinked
    // directory still resolves to the place the file will be written.
    const parent = dirname(absolute);
    return parent === absolute ? absolute : resolve(canonical(parent), basename(absolute));
  }
}

function sameFile(left: string, right: string): boolean {
  if (resolve(left) === resolve(right) || canonical(left) === canonical(right)) return true;
  try {
    if (realpathSync(left) === realpathSync(right)) return true;
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

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
  // The cache is written after the inputs are read. Pointing it at an input would overwrite that input, and pointing
  // it at the output would let the bundle replace it, so the next run would pay for the request again.
  if (flags.provider === "jev" && flags.cache) {
    if (flags.out && sameFile(flags.cache, flags.out)) {
      throw usageError("--cache and --out name the same file. Give the Jev cache its own path.");
    }
    if (sameFile(flags.cache, analysisPath) || sameFile(flags.cache, flags.rubric)) {
      throw usageError("--cache names an input file. Give the Jev cache its own path.");
    }
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
  if (flags.provider === "rules") {
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
    // The plan is what a dry run is for, so md shows it as json does.
    const markdown = [
      renderJudgeMarkdown(report),
      `- Jev: ${advisory.status} ${advisory.reason}`,
      `- Endpoint: ${advisory.endpoint}`,
      `- Planned requests: ${advisory.plannedRequests}`,
    ].join("\n");
    if (flags.out) {
      const outPath = resolve(flags.out);
      await writeTextFile(outPath, `${markdown}\n`);
      console.log(`Wrote md output to ${outPath}`);
    } else {
      console.log(markdown);
    }
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
