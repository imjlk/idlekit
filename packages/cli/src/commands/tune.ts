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
import { resolve } from "path";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, tuneSpecInvalidError, usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicRunId, deriveDeterministicSeed } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { runTuneWizard } from "../lib/tuneWizard";
import { readJsonFile } from "../runtime/bun";

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
    throw cliError("INTERNAL_ERROR", "Unable to read best score from tune result.");
  }
  return score;
}

function readBestScoreFromArtifact(x: unknown): number {
  const score = (x as any)?.result?.report?.best?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw cliError("REPLAY_ARTIFACT_INVALID", "Invalid baseline artifact: result.report.best.score(number) is required.");
  }
  return score;
}

function buildTuneInsights(outputBase: Record<string, unknown>) {
  const report = (outputBase as any).report;
  const bestScore = readBestScoreFromTuneResult(outputBase);
  const top = Array.isArray(report?.top) ? report.top : [];
  const topScores = top
    .map((entry: any) => Number(entry?.score))
    .filter((value: number) => Number.isFinite(value))
    .sort((a: number, b: number) => b - a);
  const medianTopScore =
    topScores.length > 0 ? topScores[Math.floor(topScores.length / 2)]! : bestScore;
  const relativeGap =
    Math.abs(bestScore) < 1e-12 ? 0 : Math.abs(bestScore - medianTopScore) / Math.max(1e-12, Math.abs(bestScore));

  const counter = new Map<string, { path: string; value: unknown; count: number }>();
  for (const candidate of top) {
    const params = candidate?.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) continue;
    for (const [path, value] of flattenParams(params)) {
      const key = `${path}::${JSON.stringify(value)}`;
      const prev = counter.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        counter.set(key, { path, value, count: 1 });
      }
    }
  }

  const threshold = Math.max(1, Math.ceil(top.length * 0.5));
  const patterns = [...counter.values()]
    .filter((entry) => entry.count >= threshold)
    .sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1))
    .map((entry) => ({
      path: entry.path,
      value: entry.value,
      frequency: entry.count / Math.max(1, top.length),
    }));

  return {
    summary:
      relativeGap > 0.05
        ? "Top candidate is clearly separated from the rest of the search frontier."
        : "Top candidates are clustered; this parameter space likely has a plateau.",
    patterns,
    scoreSpread: {
      best: bestScore,
      medianTop: medianTopScore,
      relativeGap,
      plateau: relativeGap <= 0.02,
    },
  };
}

function flattenParams(
  input: Record<string, unknown>,
  prefix = "",
): Array<readonly [string, unknown]> {
  const out: Array<readonly [string, unknown]> = [];
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenParams(value as Record<string, unknown>, path));
      continue;
    }
    out.push([path, value] as const);
  }
  return out;
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
    throw scenarioInvalidError(sv.issues);
  }

  const tv = validateTuneSpecV1(args.tuneSpecInput);
  if (!tv.ok || !tv.tuneSpec) {
    throw tuneSpecInvalidError(tv.issues);
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
    tune: option(z.string().optional(), { description: "TuneSpec file path (.json|.yaml)" }),
    wizard: option(z.coerce.boolean().default(false), {
      description: "Interactively generate a TuneSpec before tuning",
    }),
    "tune-out": option(z.string().optional(), {
      description: "When --wizard is true, write the generated TuneSpec to this path",
    }),
    force: option(z.coerce.boolean().default(false), {
      description: "Overwrite generated TuneSpec when --wizard is used",
    }),
    seed: option(z.coerce.number().optional(), {
      description: "Optional deterministic seed exposed in metadata/replay verification",
    }),
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
  async handler({ flags, positional, prompt, terminal }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError("Usage: idk tune <scenario> --tune <tunespec>");
    }
    if (!flags.tune && !flags.wizard) {
      throw usageError("Usage: idk tune <scenario> --tune <tunespec>");
    }

    const scenarioInput = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const wizardResult = flags.wizard
      ? await runTuneWizard({
          prompt,
          terminal,
          scenarioPath,
          scenarioInput,
          modelRegistry: loaded.modelRegistry,
          outPath: flags["tune-out"] ?? flags.tune,
          force: flags.force,
        })
      : undefined;
    const tunePath = wizardResult?.tunePath ?? flags.tune;
    if (!tunePath) {
      throw usageError("Usage: idk tune <scenario> --tune <tunespec>");
    }
    const tuneSpecInput = wizardResult?.tuneSpec ?? (await readScenarioFile(tunePath));
    const seed =
      flags.seed ??
      deriveDeterministicSeed({
        command: "tune",
        scenario: scenarioInput,
        tuneSpec: tuneSpecInput,
        options: {
          baselineArtifact: flags["baseline-artifact"] ? resolve(flags["baseline-artifact"]) : undefined,
          regressionTolerance: flags["regression-tolerance"],
        },
      });
    const runId =
      flags["run-id"] ??
      deriveDeterministicRunId({
        command: "tune",
        seed,
        scope: {
          scenarioPath: resolve(process.cwd(), scenarioPath),
          tunePath: resolve(process.cwd(), tunePath),
        },
      });
    const outputMeta = buildOutputMeta({
      command: "tune",
      scenarioPath,
      scenario: scenarioInput,
      tuneSpec: tuneSpecInput,
      runId,
      seed,
      pluginDigest: loaded.pluginDigest,
    });

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
      const baselineRaw = await readJsonFile<unknown>(baselinePath);
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
        throw cliError(
          "INTERNAL_ERROR",
          `Tune regression detected: current=${currentBest}, baseline=${baselineBest}, tolerance=${tolerance}`,
        );
      }
    }

    const outputBase = regression ? { ...(result as Record<string, unknown>), regression } : result;
    const output = (() => {
      if ((outputBase as any)?.ok !== true) return outputBase;
      return {
        ...(outputBase as Record<string, unknown>),
        insights: buildTuneInsights(outputBase as Record<string, unknown>),
      };
    })();

    if (flags["artifact-out"]) {
      const scenarioAbs = resolve(process.cwd(), scenarioPath);
      const tuneAbs = resolve(process.cwd(), tunePath);
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "tune",
        positional: [scenarioAbs],
        flags,
        forcedFlags: {
          tune: tuneAbs,
          "run-id": runId,
          seed,
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
