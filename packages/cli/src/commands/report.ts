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
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

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
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    checkpoints: option(z.string().default("60,300,900,3600"), {
      description: "Comma-separated checkpoint seconds",
    }),
    "include-growth": option(z.coerce.boolean().default(false), { description: "Include growth report" }),
    "include-ux": option(z.coerce.boolean().default(false), { description: "Include UX flags" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["md", "json"]).default("md"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk report <scenario> [--checkpoints 60,300,900,3600]");
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistries(parsePluginPaths(flags.plugin, flags["allow-plugin"]));
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw new Error(
        `Scenario invalid: ${valid.issues.map((i) => `${i.path ?? "root"}: ${i.message}`).join("; ")}`,
      );
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
        series: runInput.model.netWorth ? "netWorth" : "money",
        windowSec: valid.scenario.analysis?.growth?.windowSec ?? 60,
      });
    }

    if (flags["include-ux"]) {
      data.stats = run.stats;
      data.uxFlags = run.uxFlags;
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data,
    });
  },
});
