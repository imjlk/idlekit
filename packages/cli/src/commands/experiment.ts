import { defineCommand, option } from "../runtime/command";
import {
  runExperiment,
  validateExperimentSpec,
  validateScenarioV1,
  type ExperimentSpecV1,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { prepareResolvedRun, type ResolvedEngine } from "../lib/runConfiguration";
import { readJsonFile } from "../runtime/bun";

/**
 * Version of the engine that ran, not the scenario's engine metadata.
 * Built-in engines ship inside this CLI build. A trusted custom factory declares no version.
 */
export function experimentEngineVersion(engine: Pick<ResolvedEngine, "source">, cliVersion: string): string {
  return engine.source === "custom" ? "unversioned" : `idlekit-cli@${cliVersion}`;
}

export default defineCommand({
  name: "experiment",
  description: "Compare model and policy parameters with a fixed sweep and local sensitivity",
  options: {
    ...pluginOptions(),
    engine: option(z.string().optional(), { description: "Effective engine id" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const specPath = positional[0];
    if (!specPath) throw usageError("Usage: idk experiment <spec>");
    const loadedSpec = await readJsonFile<unknown>(specPath).catch((error) => {
      throw cliError("EXPERIMENT_SPEC_INVALID", `Unable to read experiment spec: ${specPath}`, { cause: error });
    });
    // Check the spec shape before any field is read or the scenario is resolved.
    const checked = validateExperimentSpec(loadedSpec);
    if (!checked.success) {
      throw cliError(
        "EXPERIMENT_SPEC_INVALID",
        `Experiment spec rejected: ${checked.errors.map((error) => error.path).join(", ")}`,
      );
    }
    const spec: ExperimentSpecV1 = checked.data;
    if (spec.scenario.ref.length === 0) throw usageError("Usage: idk experiment <spec>");
    const scenarioPath = resolve(spec.scenario.ref);
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
    const meta = buildOutputMeta({
      command: "experiment",
      scenarioPath,
      scenario: valid.scenario,
      effectiveEngine: prepared.engine.effectiveId,
    });
    const artifact = runExperiment({
      spec,
      scenario: valid.scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      engine: prepared.engine.engine,
      engineId: prepared.engine.effectiveId,
      engineVersion: experimentEngineVersion(prepared.engine, meta.cliVersion),
      // The candidates vary the base simulate stage of this scenario; its digest names that run.
      effectiveRunHash: prepared.open("simulate", "experiment:base").hash,
    });
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: artifact,
      meta,
    });
  },
});
