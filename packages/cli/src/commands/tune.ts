import { defineCommand, option } from "@bunli/core";
import {
  compileScenario,
  createNumberEngine,
  RandomSearchTunerV1,
  runCandidateAndScore,
  validateScenarioV1,
  validateTuneSpecV1,
  type Engine,
  type ModelRegistry,
  type ObjectiveRegistry,
  type StrategyRegistry,
} from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export async function cmdTune(args: {
  E: Engine<any>;

  scenarioInput: unknown;
  tuneSpecInput: unknown;

  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  objectiveRegistry: ObjectiveRegistry;

  unitFactory?: (code: string) => any;
}): Promise<unknown> {
  const sv = validateScenarioV1(args.scenarioInput, args.modelRegistry);
  if (!sv.ok || !sv.scenario) {
    return { ok: false, kind: "scenario", issues: sv.issues };
  }

  const tv = validateTuneSpecV1(args.tuneSpecInput);
  if (!tv.ok || !tv.tuneSpec) {
    return { ok: false, kind: "tuneSpec", issues: tv.issues };
  }

  const compiled = compileScenario({
    E: args.E,
    scenario: sv.scenario,
    registry: args.modelRegistry,
    strategyRegistry: args.strategyRegistry,
    unitFactory: args.unitFactory,
    opts: { allowSuffixNotation: true },
  });

  const report = RandomSearchTunerV1.tune({
    baseScenario: compiled,
    tuneSpec: tv.tuneSpec,
    strategyRegistry: args.strategyRegistry,
    objectiveRegistry: args.objectiveRegistry,
    runCandidate: ({ scenario, params, seeds, overrides }) =>
      runCandidateAndScore({
        baseScenario: scenario,
        params,
        strategyId: tv.tuneSpec!.strategy.id,
        objectiveId: tv.tuneSpec!.objective.id,
        objectiveParams: tv.tuneSpec!.objective.params,
        seeds,
        overrides,
        strategyRegistry: args.strategyRegistry,
        objectiveRegistry: args.objectiveRegistry,
      }),
  });

  return { ok: true, report };
}

export default defineCommand({
  name: "tune",
  description: "Tune strategy parameters with objective scoring",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    tune: option(z.string().min(1), { description: "TuneSpec file path (.json|.yaml)" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk tune <scenario> --tune <tunespec>");
    }

    const [scenarioInput, tuneSpecInput] = await Promise.all([
      readScenarioFile(scenarioPath),
      readScenarioFile(flags.tune),
    ]);

    const loaded = await loadRegistries(parsePluginPaths(flags.plugin));
    const result = await cmdTune({
      E: createNumberEngine(),
      scenarioInput,
      tuneSpecInput,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      objectiveRegistry: loaded.objectiveRegistry,
    });

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: result,
    });
  },
});
