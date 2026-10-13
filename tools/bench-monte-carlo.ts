import {
  buildPerformanceArtifact,
  currentHost,
  readChoice,
  readCount,
  readPositive,
  readSample,
  readSamples,
  readText,
  representativeConfig,
  type BenchConfig,
} from "./performanceBudget";

/**
 * Records Monte Carlo timing from caller-supplied samples.
 * Draw counts stay absent unless the caller passes them.
 * Worker startup and serialization stay absent.
 * This file does not enter the draw loop.
 */

function parseConfig(argv: string[]): {
  config: BenchConfig;
  runtimeMs: number[];
  draws: number | null;
  workload: number | null;
  prepareCold: number | undefined;
  prepareWarm: number[];
} {
  let engineId = "number";
  let seed: number | null = null;
  let modelId = "linear";
  let modelVersion = 1;
  let stepSec = 1;
  let trace: BenchConfig["trace"] = "off";
  let observer: BenchConfig["observer"] = "off";
  let runtimeMs: number[] = [];
  let draws: number | null = null;
  let workload: number | null = null;
  let prepareCold: number | undefined;
  let prepareWarm: number[] = [];

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (flag === "--engine") engineId = readText(flag, value);
    else if (flag === "--seed") seed = readCount(flag, value);
    else if (flag === "--model") modelId = readText(flag, value);
    else if (flag === "--model-version") modelVersion = readCount(flag, value);
    else if (flag === "--step") stepSec = readPositive(flag, value);
    else if (flag === "--trace") trace = readChoice(flag, value, ["off", "bounded", "unbounded"] as const);
    else if (flag === "--observer") observer = readChoice(flag, value, ["off", "on"] as const);
    else if (flag === "--runtime-ms") runtimeMs = readSamples(flag, value);
    else if (flag === "--draws") draws = readCount(flag, value);
    else if (flag === "--workload") workload = readCount(flag, value);
    else if (flag === "--prepare-cold-ms") prepareCold = readSample(flag, value);
    else if (flag === "--prepare-warm-ms") prepareWarm = readSamples(flag, value);
    else throw new Error(`unknown flag: ${flag}`);
  }

  return {
    config: representativeConfig({
      engineId,
      seed,
      modelId,
      modelVersion,
      stepSec,
      trace,
      observer,
      planner: "off",
    }),
    runtimeMs,
    draws,
    workload,
    prepareCold,
    prepareWarm,
  };
}

async function main(): Promise<void> {
  const parsed = parseConfig(process.argv);
  if (parsed.runtimeMs.length === 0) throw new Error("--runtime-ms is required");
  const artifact = buildPerformanceArtifact({
    corpus: "representative",
    scenario: null,
    config: parsed.config,
    host: currentHost(),
    iterations: parsed.runtimeMs.length,
    // Prepare samples are compiler phases. No runtime sample was discarded as warmup.
    warmup: 0,
    workloadCount: parsed.workload,
    phases: {
      prepareColdMs: parsed.prepareCold,
      prepareWarmMs: parsed.prepareWarm,
      runtimeMs: parsed.runtimeMs,
    },
    draws: parsed.draws,
  });
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

if (import.meta.main) await main();
