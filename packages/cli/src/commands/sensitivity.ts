import { defineCommand, option } from "../runtime/command";
import {
  DesignSpaceRejected,
  morrisScreening,
  sobolIndices,
  validateScenarioV1,
  type MorrisResultV1,
  type SensitivityEvaluator,
  type SobolResultV1,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import {
  assertDesignParameterPaths,
  createDesignEvaluator,
  designParameters,
  formatNumber,
  objectiveKeys,
  readDesignStudySpec,
  type DesignEvaluation,
  type DesignStudySpec,
} from "../lib/designStudy";

type GlobalResult = MorrisResultV1 | SobolResultV1;

export type SensitivityOutput = Readonly<{
  kind: "global-sensitivity";
  method: "morris" | "sobol";
  seed: number;
  spec: DesignStudySpec;
  /** Indices of the weighted score that `idk optimize` minimizes. */
  score: GlobalResult;
  /** Indices of each objective's mean metric, from the same runs. */
  objectives: Readonly<Record<string, GlobalResult>>;
  failedCandidates: number;
  firstError: string | null;
  hints: readonly string[];
}>;

function importance(result: GlobalResult, id: string): { main: number | null; spread: number | null } {
  if (result.method === "morris") {
    const row = result.parameters.find((entry) => entry.id === id);
    return { main: row?.muStar ?? null, spread: row?.sigma ?? null };
  }
  const row = result.parameters.find((entry) => entry.id === id);
  return { main: row?.totalOrder.value ?? null, spread: row ? (row.totalOrder.value ?? 0) - (row.firstOrder.value ?? 0) : null };
}

export function sensitivityHints(result: GlobalResult): string[] {
  const hints: string[] = [];
  const top = result.ranking[0];
  if (!top) return ["No parameter produced an observed effect; check failed candidates and the parameter ranges."];
  hints.push(`\`${top}\` moves the score most; tune it first.`);
  const max = importance(result, top).main ?? 0;
  const negligible = result.parameters
    .map((row) => ({ id: row.id, main: importance(result, row.id).main }))
    .filter((row) => row.main !== null && Math.abs(row.main) <= (result.method === "sobol" ? 0.01 : Math.abs(max) * 0.01));
  if (negligible.length > 0) {
    hints.push(`Negligible over these ranges, candidates to freeze: ${negligible.map((row) => `\`${row.id}\``).join(", ")}.`);
  }
  const interacting = result.parameters.filter((row) => {
    const { main, spread } = importance(result, row.id);
    if (main === null || spread === null) return false;
    return result.method === "morris" ? Math.abs(main) > 0 && spread > Math.abs(main) : spread > 0.1;
  });
  if (interacting.length > 0) {
    hints.push(
      `Interaction or non-linear effect: ${interacting.map((row) => `\`${row.id}\``).join(", ")}; tune these together, not one at a time.`,
    );
  }
  if (result.failedRuns > 0) hints.push(`${result.failedRuns} run(s) failed and were left out of the effects they touch.`);
  hints.push("For a local one-at-a-time sweep around the current values, use `idk experiment`.");
  return hints;
}

function resultTable(result: GlobalResult): string[] {
  if (result.method === "morris") {
    return [
      "| Rank | Parameter | mu* | mu | sigma | Effects |",
      "| --- | --- | --- | --- | --- | --- |",
      ...[...result.parameters]
        .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
        .map((row) => `| ${row.rank ?? "-"} | \`${row.id}\` | ${formatNumber(row.muStar)} | ${formatNumber(row.mu)} | ${formatNumber(row.sigma)} | ${row.effects} |`),
    ];
  }
  const range = (interval: { lower: number; upper: number } | null) =>
    interval ? `[${formatNumber(interval.lower, 3)}, ${formatNumber(interval.upper, 3)}]` : "n/a";
  return [
    `| Rank | Parameter | S1 | S1 ${Math.round(result.confidence * 100)}% CI | ST | ST CI |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...[...result.parameters]
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
      .map(
        (row) =>
          `| ${row.rank ?? "-"} | \`${row.id}\` | ${formatNumber(row.firstOrder.value, 3)} | ${range(row.firstOrder.interval)} | ${formatNumber(row.totalOrder.value, 3)} | ${range(row.totalOrder.interval)} |`,
      ),
  ];
}

export function renderSensitivityMarkdown(scenarioPath: string, output: SensitivityOutput): string {
  const score = output.score;
  const budget =
    score.method === "morris"
      ? `${score.trajectories} trajectories x ${score.levels} levels, ${score.runs} runs`
      : `${score.baseSamples} base samples (${score.usedSamples} used), ${score.runs} runs`;
  const lines = [
    "# Global Sensitivity",
    "",
    `- Scenario: \`${scenarioPath}\``,
    `- Method: ${output.method} (${budget})`,
    `- Seed: ${output.seed}`,
    `- Failed candidates: ${output.failedCandidates}${output.firstError ? ` (first: ${output.firstError})` : ""}`,
    "",
    "## Score importance ranking",
    "",
    ...resultTable(score),
  ];
  for (const [key, result] of Object.entries(output.objectives)) {
    lines.push("", `## Objective \`${key}\``, "", ...resultTable(result));
  }
  lines.push("", "## Decision hints", "", ...output.hints.map((hint) => `- ${hint}`));
  return `${lines.join("\n")}\n`;
}

export default defineCommand({
  name: "sensitivity",
  description: "Global sensitivity (Morris or Sobol) of design objectives over parameter ranges",
  options: {
    ...pluginOptions(),
    spec: option(z.string().min(1), { description: "Design study spec (JSON or YAML)" }),
    method: option(z.enum(["morris", "sobol"]).default("morris"), { description: "Global method" }),
    "max-runs": option(z.coerce.number().int().positive().optional(), {
      description: "Run budget. Default morris 10*(k+1), sobol 64*(k+2)",
    }),
    levels: option(z.coerce.number().int().optional(), { description: "Morris grid levels (even, >= 4)" }),
    bootstrap: option(z.coerce.number().int().min(0).default(200), { description: "Sobol bootstrap resamples" }),
    seed: option(z.coerce.number().int().default(1), { description: "Design seed (also the simulation seed)" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk sensitivity <scenario> --spec <design.json> [--method morris|sobol] [--max-runs n]");
    }
    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry, loaded.strategyRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);
    const spec = await readDesignStudySpec(flags.spec);
    assertDesignParameterPaths(valid.scenario, spec);
    const parameters = designParameters(spec);
    const k = parameters.length;
    const maxRuns = flags["max-runs"] ?? (flags.method === "morris" ? 10 * (k + 1) : 64 * (k + 2));
    const evaluate = createDesignEvaluator({
      scenario: valid.scenario,
      spec,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      seed: flags.seed,
    });
    const cache: DesignEvaluation[] = [];
    const analyze = (evaluator: SensitivityEvaluator): GlobalResult =>
      flags.method === "morris"
        ? morrisScreening({ parameters, evaluate: evaluator, seed: flags.seed, maxRuns, levels: flags.levels })
        : sobolIndices({ parameters, evaluate: evaluator, seed: flags.seed, maxRuns, bootstrap: flags.bootstrap });
    let score: GlobalResult;
    try {
      score = analyze((values, runIndex) => {
        const result = evaluate(values);
        cache[runIndex] = result;
        return result.score;
      });
    } catch (error) {
      if (error instanceof DesignSpaceRejected) throw usageError(error.message);
      throw error;
    }
    // The design points depend only on the seed, so each objective re-reads the cached runs in the same order.
    const objectives = Object.fromEntries(
      objectiveKeys(spec).map((key) => [key, analyze((_values, runIndex) => cache[runIndex]?.metrics[key] ?? null)]),
    );
    const failed = cache.filter((entry) => entry.score === null);
    const output: SensitivityOutput = {
      kind: "global-sensitivity",
      method: flags.method,
      seed: flags.seed,
      spec,
      score,
      objectives,
      failedCandidates: failed.length,
      firstError: failed.find((entry) => entry.error)?.error ?? null,
      hints: sensitivityHints(score),
    };
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: flags.format === "md" ? renderSensitivityMarkdown(scenarioPath, output) : output,
      meta: buildOutputMeta({ command: "sensitivity", scenarioPath, scenario: valid.scenario, seed: flags.seed }),
    });
  },
});
