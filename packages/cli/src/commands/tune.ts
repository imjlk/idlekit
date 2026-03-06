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
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { buildOutputMeta } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

type TuneRegression = Readonly<{
  baselinePath: string;
  baselineBestScore: number;
  currentBestScore: number;
  delta: number;
  deltaPct: number;
  tolerance: number;
  regressed: boolean;
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
    ...pluginOptions(),
    tune: option(z.string().min(1), { description: "TuneSpec file path (.json|.yaml)" }),
    "artifact-out": option(z.string().optional(), { description: "Write tune artifact JSON to path" }),
    "baseline-artifact": option(z.string().optional(), {
      description: "Compare current best score against baseline artifact",
    }),
    "run-id": option(z.string().optional(), {
      description: "Optional run identifier used in output metadata",
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
    const runId = flags["run-id"] ?? randomUUID();
    const outputMeta = buildOutputMeta({
      command: "tune",
      scenarioPath,
      scenario: scenarioInput,
      tuneSpec: tuneSpecInput,
      runId,
    });

    const loaded = await loadRegistriesFromFlags(flags);
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
      const scenarioAbs = resolve(process.cwd(), scenarioPath);
      const tuneAbs = resolve(process.cwd(), flags.tune);
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "tune",
        positional: [scenarioAbs],
        flags,
        forcedFlags: {
          tune: tuneAbs,
          "run-id": runId,
          format: "json",
        },
        result: output,
        meta: outputMeta,
        extra: {
          tuneSpecPath: tuneAbs,
          regression,
        },
      });
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
      meta: outputMeta,
    });
  },
});
