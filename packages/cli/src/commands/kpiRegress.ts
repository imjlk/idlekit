import { adaptKpiRegression } from "@idlekit/core";
import { defineCommand, option } from "../runtime/command";
import { resolve } from "path";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { readJsonFile } from "../runtime/bun";

export async function runKpiRegression(flags: {
  baseline: string;
  current: string;
  "min-worth-ratio": number;
  "max-stall-delta": number;
  "max-dropped-delta": number;
  "min-visible-progress-ratio": number;
  "max-no-reward-gap-delta": number;
  out?: string;
  format: "json" | "md" | "csv";
}) {
  const baselinePath = resolve(flags.baseline);
  const currentPath = resolve(flags.current);
  const baseline = await readJsonFile<unknown>(baselinePath);
  const current = await readJsonFile<unknown>(currentPath);
  const output = adaptKpiRegression({
    baseline,
    current,
    baselinePath,
    currentPath,
    generatedAt: new Date().toISOString(),
    minWorthRatio: flags["min-worth-ratio"],
    maxStallDelta: flags["max-stall-delta"],
    maxDroppedDelta: flags["max-dropped-delta"],
    minVisibleProgressRatio: flags["min-visible-progress-ratio"],
    maxNoRewardGapDelta: flags["max-no-reward-gap-delta"],
  });
  await writeOutput({
    format: flags.format,
    outPath: flags.out,
    data: output,
    meta: buildOutputMeta({ command: "kpi.regress" }),
  });
  return output;
}

export default defineCommand({
  name: "regress",
  description: "Run long-horizon KPI regression gate",
  options: {
    baseline: option(z.string().default("examples/bench/kpi-baseline.json"), {
      description: "Baseline KPI report path",
    }),
    current: option(z.string().default("tmp/kpi-report.json"), {
      description: "Current KPI report path",
    }),
    "min-worth-ratio": option(z.coerce.number().positive().default(0.97), {
      description: "Minimum allowed current/baseline endNetWorth ratio",
    }),
    "max-stall-delta": option(z.coerce.number().nonnegative().default(0.03), {
      description: "Maximum allowed stallRatio increase",
    }),
    "max-dropped-delta": option(z.coerce.number().nonnegative().default(0.03), {
      description: "Maximum allowed droppedRate increase",
    }),
    "min-visible-progress-ratio": option(z.coerce.number().positive().default(0.9), {
      description: "Minimum allowed current/baseline visibleChangesPerMinute ratio",
    }),
    "max-no-reward-gap-delta": option(z.coerce.number().nonnegative().default(60), {
      description: "Maximum allowed maxNoRewardGapSec increase",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags }) {
    const output = await runKpiRegression(flags);
    if (!output.pass) process.exit(2);
  },
});
