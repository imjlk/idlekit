import { defineCommand, option } from "../runtime/command";
import {
  DesignSpaceRejected,
  searchParameters,
  validateScenarioV1,
  type ParameterSearchResultV1,
  type ScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { assertOutputNotInput, writeOutput } from "../io/writeOutput";
import { writeTextFile } from "../runtime/bun";
import {
  createDesignEvaluator,
  designParameters,
  formatNumber,
  objectiveKeys,
  patchScenario,
  readDesignStudySpec,
  type DesignEvaluation,
  type DesignStudySpec,
} from "../lib/designStudy";

export type OptimizeOutput = Readonly<{
  kind: "parameter-optimization";
  spec: DesignStudySpec;
  search: ParameterSearchResultV1;
  baseline: DesignEvaluation;
  best: (DesignEvaluation & Readonly<{ values: Readonly<Record<string, number>> }>) | null;
  /** Score improvement of the best candidate over the scenario as written (positive is better). */
  improvement: number | null;
  failedCandidates: number;
  firstError: string | null;
  hints: readonly string[];
}>;

function baselineValues(scenario: unknown, spec: DesignStudySpec): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const parameter of spec.parameters) {
    let cursor: unknown = scenario;
    for (const segment of parameter.path.split(".")) {
      cursor = typeof cursor === "object" && cursor !== null && Object.hasOwn(cursor, segment) ? (cursor as Record<string, unknown>)[segment] : undefined;
    }
    const value = typeof cursor === "number" ? cursor : typeof cursor === "string" ? Number(cursor) : Number.NaN;
    if (!Number.isFinite(value)) return null;
    out[parameter.path] = value;
  }
  return out;
}

export function optimizeHints(output: Omit<OptimizeOutput, "hints">): string[] {
  const hints: string[] = [];
  if (!output.best) return ["No candidate produced a score; check failed candidates and the parameter ranges."];
  const keys = objectiveKeys(output.spec);
  if (output.improvement !== null) {
    hints.push(
      output.improvement > 0
        ? `The best candidate improves the score by ${formatNumber(output.improvement)} over the scenario as written.`
        : "No candidate beat the scenario as written; it is already near the best of this search.",
    );
  }
  for (const parameter of output.spec.parameters) {
    const value = output.best.values[parameter.path];
    if (value === undefined) continue;
    const span = parameter.max - parameter.min;
    if (value <= parameter.min + span * 0.02 || value >= parameter.max - span * 0.02) {
      hints.push(`\`${parameter.path}\` landed at the edge of its range (${formatNumber(value)}); widen the range and search again.`);
    }
  }
  for (const key of keys) {
    const before = output.baseline.metrics[key];
    const after = output.best.metrics[key];
    if (before !== undefined && after !== undefined) hints.push(`\`${key}\`: ${formatNumber(before)} -> ${formatNumber(after)}.`);
  }
  if (output.best.censoredDraws > 0) hints.push(`The best candidate still misses a milestone in ${output.best.censoredDraws} draw(s).`);
  if (output.search.stoppedBy === "time-limit") {
    hints.push("The search stopped on the time limit, so a rerun can differ; rerun with only --max-runs for a reproducible result.");
  }
  return hints;
}

export function renderOptimizeMarkdown(scenarioPath: string, output: OptimizeOutput): string {
  const keys = objectiveKeys(output.spec);
  const lines = [
    "# Parameter Optimization",
    "",
    `- Scenario: \`${scenarioPath}\``,
    `- Method: ${output.search.method}${output.search.gridLevels ? ` (${output.search.gridLevels} levels per parameter)` : ""}${output.search.generations !== null ? ` (${output.search.generations} generations)` : ""}`,
    `- Seed: ${output.search.seed}`,
    `- Runs: ${output.search.runs} of ${output.search.budget.maxRuns}${output.search.budget.timeLimitMs !== null ? `, time limit ${output.search.budget.timeLimitMs / 1000}s` : ""} (stopped by ${output.search.stoppedBy})`,
    `- Failed candidates: ${output.failedCandidates}${output.firstError ? ` (first: ${output.firstError})` : ""}`,
    `- Objectives: ${output.spec.objectives.map((objective, index) => `\`${keys[index]}\` x${objective.weight}`).join(", ")}`,
    "",
    "## Best candidate",
    "",
    ...(output.best
      ? [
          `- Score: ${formatNumber(output.best.score)} (scenario as written: ${formatNumber(output.baseline.score)})`,
          ...output.spec.parameters.map((parameter) => `- \`${parameter.path}\`: ${formatNumber(output.best!.values[parameter.path], 6)}`),
        ]
      : ["- none"]),
    "",
    "## Top candidates",
    "",
    `| Run | Score | ${output.spec.parameters.map((parameter) => `\`${parameter.path}\``).join(" | ")} |`,
    `| --- | --- | ${output.spec.parameters.map(() => "---").join(" | ")} |`,
    ...output.search.top.map(
      (row) =>
        `| ${row.runIndex} | ${formatNumber(row.score)} | ${output.spec.parameters.map((parameter) => formatNumber(row.values[parameter.path], 6)).join(" | ")} |`,
    ),
    "",
    "## Decision hints",
    "",
    ...output.hints.map((hint) => `- ${hint}`),
  ];
  return `${lines.join("\n")}\n`;
}

export default defineCommand({
  name: "optimize",
  description: "Search scenario parameters for milestone time, session pacing, net worth, or LTV objectives",
  options: {
    ...pluginOptions(),
    spec: option(z.string().min(1), { description: "Design study spec (JSON or YAML)" }),
    method: option(z.enum(["grid", "random", "ga"]).default("ga"), { description: "Search method" }),
    "max-runs": option(z.coerce.number().int().positive().max(10000).default(60), { description: "Candidate budget" }),
    "time-limit": option(z.coerce.number().positive().optional(), {
      description: "Wall-time limit in seconds, checked between candidates (recorded; not reproducible)",
    }),
    population: option(z.coerce.number().int().optional(), { description: "GA population size" }),
    top: option(z.coerce.number().int().positive().max(50).default(5), { description: "Candidates to report" }),
    seed: option(z.coerce.number().int().default(1), { description: "Search seed (also the simulation seed)" }),
    "write-best": option(z.string().optional(), { description: "Write the scenario patched with the best values to this path" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk optimize <scenario> --spec <design.json> [--method grid|random|ga] [--max-runs n] [--time-limit sec]");
    }
    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry, loaded.strategyRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);
    const spec = await readDesignStudySpec(flags.spec);
    const writeBest = flags["write-best"]
      ? await assertOutputNotInput(flags["write-best"], { protectedInputs: [scenarioPath, flags.spec] })
      : undefined;
    const evaluate = createDesignEvaluator({
      scenario: valid.scenario,
      spec,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      seed: flags.seed,
    });
    const asWritten = baselineValues(valid.scenario, spec);
    const baseline: DesignEvaluation = asWritten
      ? evaluate({})
      : { score: null, metrics: {}, censoredDraws: 0, error: "a parameter path has no numeric value in the scenario" };
    const evaluations = new Map<number, DesignEvaluation>();
    let search: ParameterSearchResultV1;
    try {
      search = searchParameters({
        parameters: designParameters(spec),
        method: flags.method,
        seed: flags.seed,
        maxRuns: flags["max-runs"],
        timeLimitMs: flags["time-limit"] === undefined ? undefined : flags["time-limit"] * 1000,
        population: flags.population,
        topK: flags.top,
        evaluate: (values, runIndex) => {
          const result = evaluate(values);
          evaluations.set(runIndex, result);
          return result.score;
        },
      });
    } catch (error) {
      if (error instanceof DesignSpaceRejected) throw usageError(error.message);
      throw error;
    }
    const bestEval = search.best ? evaluations.get(search.best.runIndex) : undefined;
    const best = search.best && bestEval ? { ...bestEval, values: search.best.values } : null;
    const failed = [...evaluations.values()].filter((entry) => entry.score === null);
    const partial = {
      kind: "parameter-optimization" as const,
      spec,
      search,
      baseline,
      best,
      improvement: best?.score !== null && best?.score !== undefined && baseline.score !== null ? baseline.score - best.score : null,
      failedCandidates: failed.length,
      firstError: failed.find((entry) => entry.error)?.error ?? null,
    };
    const output: OptimizeOutput = { ...partial, hints: optimizeHints(partial) };
    if (writeBest && best) {
      await writeTextFile(writeBest, `${JSON.stringify(patchScenario(input as ScenarioV1, best.values), null, 2)}\n`);
    }
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: flags.format === "md" ? renderOptimizeMarkdown(scenarioPath, output) : output,
      meta: buildOutputMeta({ command: "optimize", scenarioPath, scenario: valid.scenario, seed: flags.seed }),
    });
  },
});
