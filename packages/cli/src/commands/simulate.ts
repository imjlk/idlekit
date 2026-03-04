import { defineCommand, option } from "@bunli/core";
import {
  compileScenario,
  createGreedyStrategy,
  createNumberEngine,
  createPlannerStrategy,
  createScriptedStrategy,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

export default defineCommand({
  name: "simulate",
  description: "Run simulation with scenario",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    duration: option(z.coerce.number().optional(), { description: "Override durationSec" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec" }),
    strategy: option(strategySchema, { description: "greedy|planner|scripted" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast(log-domain) mode" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: econ simulate <scenario> [--duration <sec>] [--step <sec>]");
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

    const strategyId = flags.strategy ?? valid.scenario.strategy?.id;
    const strategy =
      strategyId === "greedy"
        ? createGreedyStrategy<number, string, Record<string, unknown>>()
        : strategyId === "planner"
          ? createPlannerStrategy<number, string, Record<string, unknown>>()
          : strategyId === "scripted"
            ? createScriptedStrategy<number, string, Record<string, unknown>>([])
            : compiled.strategy;

    const runScenarioInput = {
      ...compiled,
      strategy,
      run: {
        ...compiled.run,
        stepSec: flags.step ?? compiled.run.stepSec,
        durationSec: flags.duration ?? compiled.run.durationSec,
        fast: flags.fast
          ? {
              enabled: true,
              kind: "log-domain" as const,
              disableMoneyEvents: true,
            }
          : compiled.run.fast,
      },
    };

    const run = runScenario(runScenarioInput);
    const netWorth = runScenarioInput.model.netWorth?.(runScenarioInput.ctx, run.end) ?? run.end.wallet.money;

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: {
        scenario: scenarioPath,
        startT: run.start.t,
        endT: run.end.t,
        durationSec: run.end.t - run.start.t,
        endMoney: E.toString(run.end.wallet.money.amount),
        endNetWorth: E.toString(netWorth.amount),
        prestige: {
          count: run.end.prestige.count,
          points: E.toString(run.end.prestige.points),
          multiplier: E.toString(run.end.prestige.multiplier),
        },
        stats: run.stats,
        uxFlags: run.uxFlags,
      },
    });
  },
});
