import { defineCommand, option } from "@bunli/core";
import { runScenario, validateScenarioV1 } from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { pluginOptions, type PluginOptionFlags } from "./_shared/plugin";
import { loadRegistriesFromFlags } from "./_shared/plugin";
import { parseHorizons, runLtvAnalysis } from "./ltv";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicRunId, deriveDeterministicSeed } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import {
  collectExperienceSnapshot,
  renderExperienceMarkdown,
  resolveExperienceDraws,
  resolveExperienceQuantiles,
  resolveExperienceSeries,
  resolveSessionPatternId,
  resolveSessionPatternSpec,
  summarizeExperienceMonteCarlo,
} from "../lib/experience";
import { prepareResolvedRun, workflowRunHash } from "../lib/runConfiguration";
import { readScenarioFile } from "../io/readScenario";
import { ensureDir, writeTextFile } from "../runtime/bun";

const strategySchema = z.string().min(1).optional();
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
    engine?: string;
    "consistent-overrides": boolean;
    fast: boolean;
    step?: number;
    horizons: string;
    "out-dir"?: string;
    format: "json" | "md";
  }>;

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
    strategy: option(strategySchema, {
      description: "Registered strategy id. Builtins remain greedy, planner, and scripted. Unknown ids are rejected.",
    }),
    engine: option(z.string().min(1).optional(), {
      description: "Execution engine. Default number. scenario.engine is metadata. breakInfinity is explicit. breakEternity is unsupported.",
    }),
    "consistent-overrides": option(z.coerce.boolean().default(false), {
      description: "Also apply step and fast to the experience stage. Default keeps those flags on simulate and ltv.",
    }),
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

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw scenarioInvalidError(valid.issues);
    }

    const scenarioAbs = resolve(process.cwd(), scenarioPath);
    const seed =
      flags.seed ??
      deriveDeterministicSeed({
        command: "evaluate",
        scenario: valid.scenario,
        options: {
          sessionPattern: flags["session-pattern"],
          days: flags.days,
          draws: flags.draws,
          strategy: flags.strategy,
          fast: flags.fast,
          step: flags.step,
          horizons: flags.horizons,
          ...(flags.engine ? { engine: flags.engine } : {}),
          ...(flags["consistent-overrides"] ? { consistentOverrides: true } : {}),
        },
      });

    const prepared = prepareResolvedRun({
      scenario: valid.scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      pluginDigest: loaded.pluginDigest,
      engineRequest: flags.engine,
      strategyOverride: flags.strategy,
      stepSec: flags.step,
      fast: flags.fast,
      seed,
      sessionId: flags["session-pattern"],
      days: flags.days,
      consistentOverrides: flags["consistent-overrides"],
    });
    const E = prepared.engine.engine as typeof prepared.definition.ctx.E;
    const simulateOpened = prepared.open("simulate", `evaluate:simulate:${seed}`, {
      durationSec: prepared.definition.run.durationSec,
      offlineSeconds: 0,
      resumeHash: null,
      eventLogEnabled: null,
      eventLogMax: null,
    });
    const simulateScenario = simulateOpened.scenario;
    const simulateRun = runScenario(simulateScenario);
    const simulateNetWorth =
      simulateScenario.model.netWorth?.(simulateScenario.ctx, simulateRun.end) ?? simulateRun.end.wallet.money;
    const simulateRunId = deriveDeterministicRunId({
      command: "simulate",
      seed,
      scope: {
        scenarioPath: scenarioAbs,
        strategyId: simulateScenario.strategy?.id,
      },
    });
    const simulate = {
      run: {
        id: simulateRunId,
        seed,
      },
      scenario: scenarioAbs,
      startT: simulateRun.start.t,
      endT: simulateRun.end.t,
      durationSec: simulateRun.end.t - simulateRun.start.t,
      endMoney: E.toString(simulateRun.end.wallet.money.amount),
      endNetWorth: E.toString(simulateNetWorth.amount),
      stats: simulateRun.stats,
      uxFlags: simulateRun.uxFlags,
      eventLog: simulateRun.eventLog,
    };

    const experienceInputs = { draws: resolveExperienceDraws(prepared.definition, flags.draws) };
    const experienceOpened = prepared.open("experience", `evaluate:experience:${seed}`, experienceInputs);
    const experienceScenario = experienceOpened.scenario;
    const sessionPattern = resolveSessionPatternSpec({
      scenario: experienceScenario,
      sessionPatternId: resolveSessionPatternId(flags["session-pattern"]),
      days: flags.days,
    });
    const draws = resolveExperienceDraws(experienceScenario, flags.draws);
    const series = resolveExperienceSeries(experienceScenario);
    const quantiles = resolveExperienceQuantiles(experienceScenario);
    const { session, snapshot } = collectExperienceSnapshot({
      scenario: experienceScenario,
      sessionPattern,
      seed,
      series,
    });
    // The deterministic session advanced experienceScenario's model and strategy. Monte Carlo opens
    // its own stage and builds a new model and strategy for every draw from the registries.
    const monteCarloStage =
      draws > 1 ? prepared.open("experience", `evaluate:experience:${seed}:monte-carlo`, experienceInputs) : undefined;
    const monteCarlo = monteCarloStage
      ? summarizeExperienceMonteCarlo({
          scenario: monteCarloStage.scenario,
          registries: monteCarloStage.isolation.registries,
          isolation: monteCarloStage.isolation.options,
          sessionPattern,
          draws,
          seed,
          quantiles,
          series,
        })
      : undefined;
    const mode = draws > 1 ? ("monte-carlo" as const) : ("deterministic" as const);
    const experience = {
      mode,
      design: {
        intent: valid.scenario.design?.intent,
        sessionPattern,
        series,
        draws,
        quantiles,
      },
      end: {
        t: session.end.t,
        money: snapshot.endMoney,
        netWorth: snapshot.endNetWorth,
        prestige: {
          count: session.end.prestige.count,
          points: experienceScenario.ctx.E.toString(session.end.prestige.points),
          multiplier: experienceScenario.ctx.E.toString(session.end.prestige.multiplier),
        },
      },
      session: snapshot.session,
      growth: snapshot.growth,
      milestones: snapshot.milestones,
      perceived: snapshot.perceived,
      monteCarlo,
    };
    const experienceRunId = deriveDeterministicRunId({
      command: "experience",
      seed,
      scope: {
        scenarioPath: scenarioAbs,
        sessionPattern,
        draws,
      },
    });

    const ltvOpened = prepared.open("ltv", `evaluate:ltv:${seed}`, {
      horizons: parseHorizons(flags.horizons),
      draws: null,
      valuePerWorth: null,
    });
    const ltv = {
      scenario: scenarioAbs,
      ...runLtvAnalysis({
        scenario: valid.scenario,
        scenarioPath: scenarioAbs,
        compiled: ltvOpened.scenario,
        strategy: ltvOpened.scenario.strategy,
        horizonsRaw: flags.horizons,
        step: ltvOpened.plan.stage.applies.step ? flags.step : undefined,
        fast: ltvOpened.plan.stage.applies.fast ? flags.fast : false,
        seed,
      }),
    };

    const runId = simulate.run.id;
    const stageScope = {
      simulate: simulateOpened.plan.stage.applies,
      experience: experienceOpened.plan.stage.applies,
      ltv: ltvOpened.plan.stage.applies,
    };
    const simulateMeta = buildOutputMeta({
      command: "simulate",
      runId: simulate.run.id,
      scenarioPath: scenarioAbs,
      scenario: valid.scenario,
      seed,
      pluginDigest: loaded.pluginDigest,
      effectiveRunHash: simulateOpened.hash,
      effectiveEngine: prepared.engine.effectiveId,
      stageScope: { simulate: stageScope.simulate },
    });
    const experienceMeta = buildOutputMeta({
      command: "experience",
      runId: experienceRunId,
      scenarioPath: scenarioAbs,
      scenario: valid.scenario,
      seed,
      pluginDigest: loaded.pluginDigest,
      effectiveRunHash: experienceOpened.hash,
      effectiveEngine: prepared.engine.effectiveId,
      stageScope: { experience: stageScope.experience },
    });
    const ltvMeta = buildOutputMeta({
      command: "ltv",
      runId: ltv.run.id,
      scenarioPath: scenarioAbs,
      scenario: valid.scenario,
      seed,
      pluginDigest: loaded.pluginDigest,
      effectiveRunHash: ltvOpened.hash,
      effectiveEngine: prepared.engine.effectiveId,
      stageScope: { ltv: stageScope.ltv },
    });
    const evaluateMeta = buildOutputMeta({
      command: "evaluate",
      scenarioPath: scenarioAbs,
      scenario: valid.scenario,
      seed,
      runId,
      pluginDigest: loaded.pluginDigest,
      effectiveRunHash: workflowRunHash({
        simulate: simulateOpened.hash,
        experience: experienceOpened.hash,
        ltv: ltvOpened.hash,
      }),
      effectiveEngine: prepared.engine.effectiveId,
      stageScope,
    });

    const files: Record<string, string> = {
      simulate: resolve(process.cwd(), flags["out-dir"] ?? ".", "simulate.json"),
      experience: resolve(process.cwd(), flags["out-dir"] ?? ".", "experience.json"),
      ltv: resolve(process.cwd(), flags["out-dir"] ?? ".", "ltv.json"),
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
      const outDir = resolve(process.cwd(), flags["out-dir"]);
      await ensureDir(outDir);
      files.simulate = resolve(outDir, "simulate.json");
      files.experience = resolve(outDir, "experience.json");
      files.ltv = resolve(outDir, "ltv.json");
      const summaryPath = resolve(process.cwd(), flags["out-dir"], flags.format === "md" ? "summary.md" : "summary.json");
      files.summary = summaryPath;
      await writeTextFile(files.simulate, `${JSON.stringify({ ...simulate, _meta: simulateMeta }, null, 2)}\n`);
      await writeTextFile(files.experience, `${JSON.stringify({ ...experience, _meta: experienceMeta }, null, 2)}\n`);
      await writeTextFile(files.ltv, `${JSON.stringify({ ...ltv, _meta: ltvMeta }, null, 2)}\n`);
      await writeTextFile(
        summaryPath,
        flags.format === "md"
          ? `${renderEvaluateMarkdown(output)}\n`
          : `${JSON.stringify({ ...output, _meta: evaluateMeta }, null, 2)}\n`,
      );
    }

    await writeOutput({
      format: flags.format,
      data: flags.format === "md" ? renderEvaluateMarkdown(output) : output,
      meta: evaluateMeta,
    });
  },
});
