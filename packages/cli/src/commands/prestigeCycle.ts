import { defineCommand, option } from "@bunli/core";
import {
  analyzePrestigeCycle,
  compileScenario,
  createNumberEngine,
  validateScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

function parseRange(input: string): { from: number; to: number } {
  const m = input.match(/^(\d+)\.\.(\d+)$/);
  if (!m) throw new Error(`Invalid range format: ${input}. Expected 300..1800`);
  return { from: Number(m[1]), to: Number(m[2]) };
}

export default defineCommand({
  name: "prestige-cycle",
  description: "Analyze optimal prestige cycle",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    scan: option(z.string().default("300..1800"), { description: "Scan range (from..to)" }),
    step: option(z.coerce.number().default(60), { description: "Scan step sec" }),
    horizon: option(z.coerce.number().default(3600), { description: "Horizon sec" }),
    cycles: option(z.coerce.number().default(10), { description: "Cycle count" }),
    objective: option(z.enum(["netWorthPerHour", "pointsPerHour"]).default("netWorthPerHour"), {
      description: "Optimization objective",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: econ prestige-cycle <scenario> [--scan 300..1800]");
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistries(parsePluginPaths(flags.plugin));
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

    const range = parseRange(flags.scan);

    const result = analyzePrestigeCycle({
      scenario: compiled,
      scan: {
        fromSec: range.from,
        toSec: range.to,
        stepSec: flags.step,
      },
      horizonSec: flags.horizon,
      cycles: flags.cycles,
      objective: flags.objective,
    });

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: result,
    });
  },
});
