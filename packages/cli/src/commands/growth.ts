import { defineCommand, option } from "@bunli/core";
import {
  analyzeGrowth,
  compileScenario,
  createNumberEngine,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export default defineCommand({
  name: "growth",
  description: "Analyze growth regime from simulation trace",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    window: option(z.coerce.number().default(60), { description: "Window sec" }),
    series: option(z.enum(["money", "netWorth"]).default("money"), { description: "Series type" }),
    "trace-every": option(z.coerce.number().default(1), { description: "Trace every N steps" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk growth <scenario> [--window 60] [--series money|netWorth]");
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

    const run = runScenario({
      ...compiled,
      run: {
        ...compiled.run,
        trace: {
          everySteps: Math.max(1, flags["trace-every"]),
          keepActionsLog: false,
        },
      },
    });
    const report = analyzeGrowth({
      run,
      series: flags.series,
      windowSec: flags.window,
    });

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: report,
    });
  },
});
