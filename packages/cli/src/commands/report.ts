import { defineCommand, option } from "@bunli/core";
import {
  analyzeGrowth,
  compileScenario,
  createNumberEngine,
  formatMoney,
  runScenario,
  validateScenarioV1,
  buildTimeline,
} from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { collectExperienceSnapshot, resolveSessionPatternId, resolveSessionPatternSpec } from "../lib/experience";
import { scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

function parseCheckpoints(raw: string): number[] {
  return raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
}

export default defineCommand({
  name: "report",
  description: "Generate timeline report",
  options: {
    ...pluginOptions(),
    checkpoints: option(z.string().default("60,300,900,3600"), {
      description: "Comma-separated checkpoint seconds",
    }),
    "include-growth": option(z.coerce.boolean().default(false), { description: "Include growth report" }),
    "include-ux": option(z.coerce.boolean().default(false), { description: "Include UX flags" }),
    "include-milestones": option(z.coerce.boolean().default(false), { description: "Include milestone report" }),
    "include-perceived": option(z.coerce.boolean().default(false), { description: "Include perceived progression report" }),
    "session-pattern": option(
      z.enum(["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"]).optional(),
      { description: "Session pattern for milestone/perceived report sections" },
    ),
    days: option(z.coerce.number().int().positive().optional(), {
      description: "Session-pattern day count for milestone/perceived report sections",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["md", "json"]).default("md"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk report <scenario> [--checkpoints 60,300,900,3600]");
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw scenarioInvalidError(valid.issues);
    }

    const E = createNumberEngine();
    const compiled = compileScenario<number, string, Record<string, unknown>>({
      E,
      scenario: valid.scenario,
      registry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      opts: { allowSuffixNotation: true },
    });

    const runInput = {
      ...compiled,
      run: {
        ...compiled.run,
        trace: { everySteps: 1, keepActionsLog: true },
      },
    };
    const run = runScenario(runInput);

    const checkpoints = parseCheckpoints(flags.checkpoints);
    const timeline = buildTimeline({
      run,
      checkpointsSec: checkpoints,
      formatMoney: (amount) =>
        formatMoney(E, { unit: runInput.ctx.unit, amount }, { showUnit: true, trimTrailingZeros: true }),
      formatNetWorth: (amount) =>
        formatMoney(E, { unit: runInput.ctx.unit, amount }, { showUnit: true, trimTrailingZeros: true }),
    });

    const data: Record<string, unknown> = {
      scenario: scenarioPath,
      timeline,
    };

    if (flags["include-growth"]) {
      data.growth = analyzeGrowth({
        run,
        scenario: runInput,
        series: runInput.model.netWorth ? "netWorth" : "money",
        windowSec: valid.scenario.analysis?.growth?.windowSec ?? 60,
      });
    }

    if (flags["include-ux"]) {
      data.stats = run.stats;
      data.uxFlags = run.uxFlags;
    }

    if (flags["include-milestones"] || flags["include-perceived"]) {
      const experience = collectExperienceSnapshot({
        scenario: runInput,
        sessionPattern: resolveSessionPatternSpec({
          scenario: runInput,
          sessionPatternId: resolveSessionPatternId(flags["session-pattern"]),
          days: flags.days,
        }),
        seed: runInput.ctx.seed,
      });
      data.session = experience.snapshot.session;
      if (flags["include-milestones"]) {
        data.milestones = experience.snapshot.milestones;
      }
      if (flags["include-perceived"]) {
        data.perceived = experience.snapshot.perceived;
      }
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data,
      meta: buildOutputMeta({
        command: "report",
        scenarioPath,
        scenario: valid.scenario,
      }),
    });
  },
});
