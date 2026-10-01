import { defineCommand, option } from "../runtime/command";
import {
  runExperiment,
  validateScenarioV1,
  type Engine,
  type ExperimentSpecV1,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { prepareResolvedRun } from "../lib/runConfiguration";
import { readJsonFile } from "../runtime/bun";

export default defineCommand({
  name: "experiment",
  description: "Compare model, policy, and session parameters with a fixed sweep and local sensitivity",
  options: {
    ...pluginOptions(),
    engine: option(z.string().optional(), { description: "Effective engine id" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const specPath = positional[0];
    if (!specPath) throw usageError("Usage: idk experiment <spec>");
    const loadedSpec = await readJsonFile<ExperimentSpecV1>(specPath).catch((error) => {
      throw cliError("EXPERIMENT_SPEC_INVALID", `Unable to read experiment spec: ${specPath}`, { cause: error });
    });
    const scenarioPath = resolve(loadedSpec.scenario?.ref ?? "");
    if (!loadedSpec.scenario?.ref) throw usageError("Usage: idk experiment <spec>");
    const scenario = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(scenario, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);
    const prepared = prepareResolvedRun({
      scenario: valid.scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      engineRequest: flags.engine,
    });
    const artifact = runExperiment({
      spec: loadedSpec,
      scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      engine: prepared.engine.engine as Engine<number>,
      engineId: prepared.engine.effectiveId,
      engineVersion: valid.scenario.engine?.version ?? prepared.engine.effectiveId,
      // The candidates vary the base simulate stage of this scenario; its digest names that run.
      effectiveRunHash: prepared.open("simulate", "experiment:base").hash,
    });
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: artifact,
      meta: buildOutputMeta({
        command: "experiment",
        scenarioPath,
        scenario: valid.scenario,
      }),
    });
  },
});
