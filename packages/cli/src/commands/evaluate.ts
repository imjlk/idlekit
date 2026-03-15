import { defineCommand, option } from "@bunli/core";
import { resolve } from "path";
import { z } from "zod";
import { pluginOptions, type PluginOptionFlags } from "./_shared/plugin";
import { usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicRunId, deriveDeterministicSeed } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { createTempDir, ensureDir, readJsonFile, removePath, writeTextFile } from "../runtime/bun";
import { runSelfCli } from "../runtime/selfCli";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();
const sessionPatternSchema = z
  .enum(["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"])
  .optional();

type EvaluateFlags = PluginOptionFlags &
  Readonly<{
    "session-pattern"?: z.infer<typeof sessionPatternSchema>;
    days?: number;
    draws?: number;
    seed?: number;
    strategy?: z.infer<typeof strategySchema>;
    fast: boolean;
    step?: number;
    horizons: string;
    "out-dir"?: string;
    format: "json" | "md";
  }>;

function pluginArgs(flags: PluginOptionFlags): string[] {
  const args: string[] = [];
  if (flags.plugin) args.push("--plugin", flags.plugin);
  if (flags["allow-plugin"]) args.push("--allow-plugin", "true");
  if (flags["plugin-root"]) args.push("--plugin-root", flags["plugin-root"]);
  if (flags["plugin-sha256"]) args.push("--plugin-sha256", flags["plugin-sha256"]);
  if (flags["plugin-trust-file"]) args.push("--plugin-trust-file", flags["plugin-trust-file"]);
  return args;
}

function sharedEvalArgs(flags: EvaluateFlags, seed: number): string[] {
  const args = [...pluginArgs(flags), "--seed", String(seed)];
  if (flags.strategy) args.push("--strategy", flags.strategy);
  if (flags.fast) args.push("--fast", "true");
  if (flags.step !== undefined) args.push("--step", String(flags.step));
  return args;
}

function experienceArgs(flags: EvaluateFlags, seed: number): string[] {
  const args = [...pluginArgs(flags), "--seed", String(seed)];
  if (flags["session-pattern"]) args.push("--session-pattern", flags["session-pattern"]);
  if (flags.days !== undefined) args.push("--days", String(flags.days));
  if (flags.draws !== undefined) args.push("--draws", String(flags.draws));
  return args;
}

function renderEvaluateMarkdown(output: Record<string, any>): string {
  const sections = [
    "# Evaluate Report",
    "",
    `- Scenario: ${output.scenario}`,
    `- Run ID: ${output.run.id}`,
    `- Seed: ${output.run.seed}`,
    "",
    "## Simulate",
    "",
    `- End money: ${output.simulate.endMoney}`,
    `- End net worth: ${output.simulate.endNetWorth}`,
    `- Duration sec: ${output.simulate.durationSec}`,
    "",
    "## Experience",
    "",
    `- Intent: ${output.experience.design.intent ?? "n/a"}`,
    `- Session pattern: ${output.experience.design.sessionPattern.id}`,
    `- Visible changes/min: ${output.experience.perceived.visibleChangesPerMinute}`,
    `- Max no-reward gap sec: ${output.experience.perceived.maxNoRewardGapSec}`,
    "",
    "## LTV",
    "",
    `- at30m: ${output.ltv.summary?.at30m?.endNetWorth ?? "n/a"}`,
    `- at7d: ${output.ltv.summary?.at7d?.endNetWorth ?? "n/a"}`,
    `- at30d: ${output.ltv.summary?.at30d?.endNetWorth ?? "n/a"}`,
    `- at90d: ${output.ltv.summary?.at90d?.endNetWorth ?? "n/a"}`,
  ];

  if (output.files) {
    sections.push("", "## Saved Files", "");
    for (const [key, value] of Object.entries(output.files)) {
      sections.push(`- ${key}: ${value}`);
    }
  }

  return sections.join("\n");
}

export default defineCommand({
  name: "evaluate",
  description: "Run validate + simulate + experience + ltv as one workflow",
  options: {
    ...pluginOptions(),
    "session-pattern": option(sessionPatternSchema, {
      description: "Session pattern override for experience",
    }),
    days: option(z.coerce.number().int().positive().optional(), {
      description: "Session-pattern day count for experience",
    }),
    draws: option(z.coerce.number().int().positive().optional(), {
      description: "Monte Carlo draw count for experience",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed override" }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast mode for simulate/ltv" }),
    step: option(z.coerce.number().positive().optional(), { description: "Override stepSec for simulate/ltv" }),
    horizons: option(z.string().default("30m,2h,24h,7d,30d,90d"), {
      description: "LTV horizons override",
    }),
    "out-dir": option(z.string().optional(), {
      description: "Optional directory to save simulate/experience/ltv/summary outputs",
    }),
    format: option(z.enum(["json", "md"]).default("json"), {
      description: "Summary output format",
    }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk evaluate <scenario> [--out-dir <path>]");
    }

    const scenarioAbs = resolve(process.cwd(), scenarioPath);
    const seed =
      flags.seed ??
      deriveDeterministicSeed({
        command: "evaluate",
        scenarioPath: scenarioAbs,
        options: {
          sessionPattern: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          strategy: flags.strategy,
          fast: flags.fast,
          step: flags.step,
          horizons: flags.horizons,
        },
      });

    const validateResult = runSelfCli(["validate", scenarioAbs, ...pluginArgs(flags)]);
    if (validateResult.exitCode !== 0) {
      throw new Error(validateResult.stderr.trim() || validateResult.stdout.trim() || "validate failed");
    }

    const outDir = flags["out-dir"] ? resolve(process.cwd(), flags["out-dir"]) : await createTempDir("idlekit-evaluate");
    await ensureDir(outDir);

    const simulatePath = resolve(outDir, "simulate.json");
    const experiencePath = resolve(outDir, "experience.json");
    const ltvPath = resolve(outDir, "ltv.json");

    const simulateRun = runSelfCli([
      "simulate",
      scenarioAbs,
      ...sharedEvalArgs(flags, seed),
      "--format",
      "json",
      "--out",
      simulatePath,
    ]);
    if (simulateRun.exitCode !== 0) {
      throw new Error(simulateRun.stderr.trim() || simulateRun.stdout.trim() || "simulate failed");
    }

    const experienceRun = runSelfCli([
      "experience",
      scenarioAbs,
      ...experienceArgs(flags, seed),
      "--format",
      "json",
      "--out",
      experiencePath,
    ]);
    if (experienceRun.exitCode !== 0) {
      throw new Error(experienceRun.stderr.trim() || experienceRun.stdout.trim() || "experience failed");
    }

    const ltvRun = runSelfCli([
      "ltv",
      scenarioAbs,
      ...sharedEvalArgs(flags, seed),
      "--horizons",
      flags.horizons,
      "--format",
      "json",
      "--out",
      ltvPath,
    ]);
    if (ltvRun.exitCode !== 0) {
      throw new Error(ltvRun.stderr.trim() || ltvRun.stdout.trim() || "ltv failed");
    }

    const simulate = await readJsonFile<Record<string, any>>(simulatePath);
    const experience = await readJsonFile<Record<string, any>>(experiencePath);
    const ltv = await readJsonFile<Record<string, any>>(ltvPath);

    const runId =
      simulate.run?.id ??
      deriveDeterministicRunId({
        command: "evaluate",
        seed,
        scope: {
          scenarioPath: scenarioAbs,
        },
      });

    const files: Record<string, string> = {
      simulate: simulatePath,
      experience: experiencePath,
      ltv: ltvPath,
    };

    const output = {
      ok: true,
      scenario: scenarioAbs,
      run: {
        id: runId,
        seed,
      },
      simulate: {
        endMoney: simulate.endMoney,
        endNetWorth: simulate.endNetWorth,
        durationSec: simulate.durationSec,
        stats: simulate.stats,
      },
      experience: {
        design: experience.design,
        session: experience.session,
        growth: experience.growth,
        milestones: experience.milestones,
        perceived: experience.perceived,
        monteCarlo: experience.monteCarlo,
      },
      ltv: {
        summary: ltv.summary,
        horizons: ltv.horizons,
      },
      files: flags["out-dir"] ? files : undefined,
    };

    if (flags["out-dir"]) {
      const summaryPath = resolve(process.cwd(), flags["out-dir"], flags.format === "md" ? "summary.md" : "summary.json");
      files.summary = summaryPath;
      await writeTextFile(
        summaryPath,
        flags.format === "md" ? `${renderEvaluateMarkdown(output)}\n` : `${JSON.stringify(output, null, 2)}\n`,
      );
    }

    await writeOutput({
      format: flags.format,
      data: flags.format === "md" ? renderEvaluateMarkdown(output) : output,
      meta: buildOutputMeta({
        command: "evaluate",
        scenarioPath: scenarioAbs,
        seed,
        runId,
        pluginDigest:
          simulate && typeof simulate === "object" && typeof simulate._meta === "object" && simulate._meta
            ? (simulate._meta.pluginDigest as Record<string, string> | undefined)
            : undefined,
      }),
    });

    if (!flags["out-dir"]) {
      await removePath(outDir);
    }
  },
});
