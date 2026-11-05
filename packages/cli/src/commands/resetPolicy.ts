import { defineCommand, option } from "../runtime/command";
import {
  analyzeResetPolicies,
  compileScenario,
  createNumberEngine,
  noResetBaselineNetWorth,
  ResetPolicyRejected,
  summarizeResetPolicy,
  validateScenarioV1,
  type ResetCycleInsightsV1,
  type ResetPolicyArtifactV1,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { formatNumber } from "../lib/designStudy";

function parseRange(input: string): { from: number; to: number } {
  const m = input.match(/^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/);
  if (!m) throw cliError("CLI_USAGE", `Invalid range format: ${input}. Expected 300..1800`);
  return { from: Number(m[1]), to: Number(m[2]) };
}

function parseWindows(input: string): number[] {
  const windows = input.split(",").map((part) => Number(part.trim()));
  if (windows.length < 2 || windows.some((value) => !Number.isInteger(value) || value < 2)) {
    throw usageError(`--stability-windows needs at least two integers >= 2 (received ${input})`);
  }
  return windows;
}

export type ResetPolicyOutput = Readonly<{
  kind: "reset-policy";
  artifact: ResetPolicyArtifactV1;
  insights: ResetCycleInsightsV1;
}>;

export function renderResetPolicyMarkdown(scenarioPath: string, output: ResetPolicyOutput): string {
  const { artifact, insights } = output;
  const lines = [
    "# Reset Policy",
    "",
    `- Scenario: \`${scenarioPath}\``,
    `- Objective: ${artifact.objective}`,
    `- Status: ${artifact.status}`,
    `- Scan: ${artifact.best.comparison.fromSec}s..${artifact.best.comparison.toSec}s step ${artifact.best.comparison.stepSec}s over a ${artifact.best.comparison.horizonSec}s horizon`,
    `- Optimal interval (scan-range best, not a global optimum): ${insights.optimalIntervalSec}s`,
    `- Timing window within ${Math.round(insights.timingWindow.tolerance * 100)}%: ${insights.timingWindow.fromSec}s..${insights.timingWindow.toSec}s`,
    ...(insights.baseline ? [`- No-reset baseline net worth: \`${insights.baseline.netWorth}\``] : []),
    "",
    "## Candidates",
    "",
    "| Interval | Cycles | Reward / hour | Reward / cycle | ROI vs no reset | Stability | Recovery | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...insights.rows.map(
      (row) =>
        `| ${row.intervalSec}s | ${row.completedCycles} | ${formatNumber(row.rewardPerHour)} | ${formatNumber(row.rewardPerCycle)} | ${
          row.roiVsNoReset === null ? "n/a" : `${(row.roiVsNoReset * 100).toFixed(1)}%`
        } | ${row.stability} | ${row.recoverySec === null ? "censored" : `${formatNumber(row.recoverySec)}s`} | ${row.status} |`,
    ),
    "",
    "## Decision hints",
    "",
    ...insights.hints.map((hint) => `- ${hint}`),
    "",
    "## Assumptions",
    "",
    ...artifact.assumptions.map((line) => `- ${line}`),
  ];
  return `${lines.join("\n")}\n`;
}

export default defineCommand({
  name: "reset-policy",
  description: "Compare reset intervals by committed reward, ROI against never resetting, and cycle stability",
  options: {
    ...pluginOptions(),
    scan: option(z.string().default("300..1800"), { description: "Interval scan range (from..to seconds)" }),
    step: option(z.coerce.number().positive().default(300), { description: "Scan step seconds" }),
    horizon: option(z.coerce.number().positive().default(7200), { description: "Horizon seconds per candidate" }),
    cycles: option(z.coerce.number().int().positive().default(20), { description: "Maximum committed resets per candidate" }),
    objective: option(z.enum(["cumulative-reset-reward", "final-net-worth"]).default("cumulative-reset-reward"), {
      description: "Ranking objective",
    }),
    recovery: option(z.enum(["pre-reset-net-worth", "pre-reset-income"]).default("pre-reset-net-worth"), {
      description: "Recovery threshold metric",
    }),
    "min-cycles": option(z.coerce.number().int().positive().default(3), { description: "Cycles needed to judge stability" }),
    "stability-windows": option(z.string().default("2,3"), { description: "Comma-separated window sizes (>= 2)" }),
    "relative-tolerance": option(z.coerce.number().min(0).default(0.1), { description: "Relative tolerance between windows" }),
    "absolute-tolerance": option(z.string().default("0"), { description: "Absolute tolerance between windows" }),
    plateau: option(z.coerce.number().min(0).max(0.99).default(0.05), { description: "Timing window tolerance" }),
    "skip-baseline": option(z.coerce.boolean().default(false), { description: "Skip the no-reset baseline run (ROI is then null)" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk reset-policy <scenario> [--scan 300..1800] [--step 300] [--horizon 7200]");
    }
    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry, loaded.strategyRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);
    const scenario = valid.scenario;
    const createScenario = () =>
      compileScenario<number, string, Record<string, unknown>>({
        E: createNumberEngine(),
        scenario,
        registry: loaded.modelRegistry,
        strategyRegistry: loaded.strategyRegistry,
        opts: { allowSuffixNotation: true },
      });
    const range = parseRange(flags.scan);
    let output: ResetPolicyOutput;
    try {
      const artifact = analyzeResetPolicies({
        createScenario,
        scan: { fromSec: range.from, toSec: range.to, stepSec: flags.step },
        horizonSec: flags.horizon,
        cycleBudget: flags.cycles,
        objective: flags.objective,
        recovery: { metric: flags.recovery },
        stability: {
          minObservedCycles: flags["min-cycles"],
          windows: parseWindows(flags["stability-windows"]),
          absoluteTolerance: flags["absolute-tolerance"],
          relativeTolerance: flags["relative-tolerance"],
        },
      });
      const compiled = createScenario();
      const baseline = !flags["skip-baseline"]
        ? compiled.ctx.E.toString(noResetBaselineNetWorth(compiled, flags.horizon))
        : undefined;
      output = {
        kind: "reset-policy",
        artifact,
        insights: summarizeResetPolicy(artifact, { baselineNetWorth: baseline, plateauTolerance: flags.plateau }),
      };
    } catch (error) {
      if (error instanceof ResetPolicyRejected) throw usageError(error.message);
      throw error;
    }
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: flags.format === "md" ? renderResetPolicyMarkdown(scenarioPath, output) : output,
      meta: buildOutputMeta({ command: "reset-policy", scenarioPath, scenario: valid.scenario }),
    });
  },
});
