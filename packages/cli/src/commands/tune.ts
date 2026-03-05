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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

type TuneRegression = Readonly<{
  baselinePath: string;
  baselineBestScore: number;
  currentBestScore: number;
  delta: number;
  deltaPct: number;
  tolerance: number;
  regressed: boolean;
}>;

type TuneArtifactV1 = Readonly<{
  v: 1;
  generatedAt: string;
  meta: ReturnType<typeof buildOutputMeta>;
  scenarioPath: string;
  tuneSpecPath: string;
  result: unknown;
  regression?: TuneRegression;
}>;

function readBestScoreFromTuneResult(x: unknown): number {
  const score = (x as any)?.report?.best?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("Unable to read best score from tune result.");
  }
  return score;
}

function readBestScoreFromArtifact(x: unknown): number {
  const score = (x as any)?.result?.report?.best?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("Invalid baseline artifact: result.report.best.score(number) is required.");
  }
  return score;
}

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
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    "plugin-root": option(z.string().default(""), {
      description: "Comma-separated allowed plugin root directories",
    }),
    "plugin-sha256": option(z.string().default(""), {
      description: "Comma-separated '<path>=<sha256>' plugin integrity map",
    }),
    "plugin-trust-file": option(z.string().default(""), {
      description: "Plugin trust policy json file path",
    }),
    tune: option(z.string().min(1), { description: "TuneSpec file path (.json|.yaml)" }),
    "artifact-out": option(z.string().optional(), { description: "Write tune artifact JSON to path" }),
    "baseline-artifact": option(z.string().optional(), {
      description: "Compare current best score against baseline artifact",
    }),
    "regression-tolerance": option(z.coerce.number().default(0), {
      description: "Allowed score decrease before regression is flagged",
    }),
    "fail-on-regression": option(z.coerce.boolean().default(false), {
      description: "Exit with error when regression is detected",
    }),
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
    const outputMeta = buildOutputMeta({
      command: "tune",
      scenarioPath,
      scenario: scenarioInput,
      tuneSpec: tuneSpecInput,
    });

    const loaded = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
        trustFile: flags["plugin-trust-file"],
      }),
    );
    const result = await cmdTune({
      E: createNumberEngine(),
      scenarioInput,
      tuneSpecInput,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      objectiveRegistry: loaded.objectiveRegistry,
    });

    let regression: TuneRegression | undefined;
    if (flags["baseline-artifact"]) {
      const baselinePath = resolve(flags["baseline-artifact"]);
      const baselineRaw = JSON.parse(await readFile(baselinePath, "utf8"));
      const baselineBest = readBestScoreFromArtifact(baselineRaw);
      const currentBest = readBestScoreFromTuneResult(result);
      const delta = currentBest - baselineBest;
      const deltaPct = baselineBest === 0 ? (delta === 0 ? 0 : Number.POSITIVE_INFINITY) : (delta / baselineBest) * 100;
      const tolerance = flags["regression-tolerance"];
      const regressed = currentBest + tolerance < baselineBest;

      regression = {
        baselinePath,
        baselineBestScore: baselineBest,
        currentBestScore: currentBest,
        delta,
        deltaPct,
        tolerance,
        regressed,
      };

      if (regressed && flags["fail-on-regression"]) {
        throw new Error(
          `Tune regression detected: current=${currentBest}, baseline=${baselineBest}, tolerance=${tolerance}`,
        );
      }
    }

    const output = regression ? { ...(result as Record<string, unknown>), regression } : result;

    if (flags["artifact-out"]) {
      const artifactPath = resolve(flags["artifact-out"]);
      const artifact: TuneArtifactV1 = {
        v: 1,
        generatedAt: new Date().toISOString(),
        meta: outputMeta,
        scenarioPath: resolve(scenarioPath),
        tuneSpecPath: resolve(flags.tune),
        result,
        regression,
      };
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
      meta: outputMeta,
    });
  },
});
