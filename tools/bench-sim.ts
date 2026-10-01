import { existsSync, readdirSync, statSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { ROOT, ensureDir, runJson } from "./_bun";
import {
  buildPerformanceArtifact,
  comparePerformanceBudgets,
  currentHost,
  median,
  readPerformanceArtifact,
  workloadStepCount,
  type BenchConfig,
  type PerformanceArtifact,
} from "./performanceBudget";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ROOT = resolve(REPO_ROOT, "packages/cli");

type Args = Readonly<{
  scenarios: string[];
  iterations: number;
  warmup: number;
  thresholdMs: number;
  thresholdP95Ms?: number;
  thresholdRssDeltaBytes?: number;
  assert: boolean;
  out?: string;
  baseline?: string;
  corpus: "representative" | "long";
  relativeSlowdown: number;
  absoluteMedianMs: number;
  minIterations: number;
}>;

function parseArgs(argv: string[]): Args {
  let scenarios = ["examples/bench/representative.json"];
  let iterations = 7;
  let warmup = 2;
  let thresholdMs = 500;
  let thresholdP95Ms: number | undefined;
  let thresholdRssDeltaBytes: number | undefined;
  let assert = false;
  let out: string | undefined;
  let baseline: string | undefined;
  let corpus: "representative" | "long" = "representative";
  let relativeSlowdown = 0.25;
  let absoluteMedianMs = thresholdMs;
  let minIterations = iterations;
  let absoluteSet = false;
  let minSet = false;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario") scenarios = [argv[++i] ?? scenarios[0]!];
    else if (a === "--scenarios") scenarios = (argv[++i] ?? scenarios.join(",")).split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--iterations") iterations = Number(argv[++i] ?? iterations);
    else if (a === "--warmup") warmup = Number(argv[++i] ?? warmup);
    else if (a === "--threshold-ms") thresholdMs = Number(argv[++i] ?? thresholdMs);
    else if (a === "--threshold-p95-ms") thresholdP95Ms = Number(argv[++i] ?? thresholdP95Ms);
    else if (a === "--threshold-rss-delta-bytes") thresholdRssDeltaBytes = Number(argv[++i] ?? thresholdRssDeltaBytes);
    else if (a === "--assert") assert = true;
    else if (a === "--out") out = argv[++i];
    else if (a === "--baseline") baseline = argv[++i];
    else if (a === "--corpus") {
      const value = argv[++i];
      if (value !== "representative" && value !== "long") throw new Error("--corpus must be representative or long");
      corpus = value;
    } else if (a === "--relative") relativeSlowdown = Number(argv[++i] ?? relativeSlowdown);
    else if (a === "--absolute-median-ms") {
      absoluteMedianMs = Number(argv[++i] ?? absoluteMedianMs);
      absoluteSet = true;
    } else if (a === "--min-iterations") {
      minIterations = Number(argv[++i] ?? minIterations);
      minSet = true;
    }
  }

  if (!absoluteSet) absoluteMedianMs = thresholdMs;
  if (!minSet) minIterations = iterations;

  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error("--iterations must be an integer > 0");
  if (!Number.isInteger(warmup) || warmup < 0) throw new Error("--warmup must be an integer >= 0");
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) throw new Error("--threshold-ms must be a finite number > 0");
  if (thresholdP95Ms !== undefined && (!Number.isFinite(thresholdP95Ms) || thresholdP95Ms <= 0)) {
    throw new Error("--threshold-p95-ms must be a finite number > 0");
  }
  if (
    thresholdRssDeltaBytes !== undefined &&
    (!Number.isFinite(thresholdRssDeltaBytes) || thresholdRssDeltaBytes < 0)
  ) {
    throw new Error("--threshold-rss-delta-bytes must be a finite number >= 0");
  }
  if (!Number.isFinite(relativeSlowdown) || relativeSlowdown < 0) throw new Error("--relative must be a finite number >= 0");
  if (!Number.isFinite(absoluteMedianMs) || absoluteMedianMs <= 0) {
    throw new Error("--absolute-median-ms must be a finite number > 0");
  }
  if (!Number.isInteger(minIterations) || minIterations <= 0) throw new Error("--min-iterations must be an integer > 0");
  if (scenarios.length === 0) throw new Error("--scenarios must include at least one path");

  return {
    scenarios,
    iterations,
    warmup,
    thresholdMs,
    thresholdP95Ms,
    thresholdRssDeltaBytes,
    assert,
    out,
    baseline,
    corpus,
    relativeSlowdown,
    absoluteMedianMs,
    minIterations,
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? null;
}

function resolveScenarioPath(input: string): string {
  return isAbsolute(input) ? input : resolve(REPO_ROOT, input);
}

const BUNDLE_INPUTS = [
  "package.json",
  "bun.lock",
  "packages/cli/package.json",
  "packages/cli/src",
  "packages/cli/scripts",
  "packages/core/package.json",
  "packages/core/src",
  "packages/money/package.json",
  "packages/money/src",
];

function newestMtime(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const name of readdirSync(path)) {
    newest = Math.max(newest, newestMtime(resolve(path, name)));
  }
  return newest;
}

/** Rebuild when the shipped bundle is missing or older than a bundled source. */
function ensureFreshBundle(): string {
  const bundled = resolve(CLI_ROOT, "dist/main.js");
  const fresh =
    existsSync(bundled) &&
    BUNDLE_INPUTS.every((rel) => {
      const input = resolve(REPO_ROOT, rel);
      return !existsSync(input) || newestMtime(input) <= statSync(bundled).mtimeMs;
    });
  if (!fresh) {
    const proc = Bun.spawnSync(["bun", "run", "build"], {
      cwd: CLI_ROOT,
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    });
    if ((proc.exitCode ?? 1) !== 0 || !existsSync(bundled)) {
      throw new Error("simulate benchmark could not refresh packages/cli/dist/main.js");
    }
  }
  return bundled;
}

function runSimulateOnce(bundled: string, scenarioPath: string): unknown {
  // --config skips the CLI bunfig preload. Timing `bun src/main.ts` measures
  // ttsc program setup (several seconds) instead of simulate.
  const parsed = runJson(
    ["bun", `--config=${resolve(REPO_ROOT, "tools/bench-bunfig.toml")}`, bundled, "simulate", scenarioPath, "--format", "json"],
    { cwd: CLI_ROOT, env: process.env },
  );
  if (!parsed || typeof parsed !== "object") throw new Error("simulate benchmark returned non-object output");
  return parsed;
}

function retainedOf(output: unknown): number | null {
  if (!output || typeof output !== "object") return null;
  const record = output as { eventLog?: { retained?: unknown }; summaries?: { eventLog?: { retained?: unknown } } };
  const direct = record.eventLog?.retained;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const nested = record.summaries?.eventLog?.retained;
  if (typeof nested === "number" && Number.isFinite(nested)) return nested;
  return null;
}

function configFromScenario(raw: unknown): BenchConfig {
  const scenario = raw && typeof raw === "object" ? raw as {
    seed?: unknown;
    engine?: { name?: unknown };
    model?: { id?: unknown; version?: unknown };
    clock?: { stepSec?: unknown; durationSec?: unknown };
    strategy?: { id?: unknown };
    outputs?: { report?: { includeTrace?: unknown; everySteps?: unknown } };
    observation?: { enabled?: unknown };
  } : {};
  const includeTrace = scenario.outputs?.report?.includeTrace === true;
  const every = scenario.outputs?.report?.everySteps;
  const trace = !includeTrace ? "off" : typeof every === "number" && every > 0 ? "bounded" : "unbounded";
  return {
    engineId: typeof scenario.engine?.name === "string" ? scenario.engine.name : "number",
    seed: typeof scenario.seed === "number" ? scenario.seed : null,
    modelId: typeof scenario.model?.id === "string" ? scenario.model.id : "unknown",
    modelVersion: typeof scenario.model?.version === "number" ? scenario.model.version : 0,
    stepSec: typeof scenario.clock?.stepSec === "number" ? scenario.clock.stepSec : 1,
    trace,
    observer: scenario.observation?.enabled === true ? "on" : "off",
    worker: "none",
    planner: scenario.strategy?.id === "planner" ? "on" : "off",
  };
}

function workloadOf(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const clock = (raw as { clock?: { durationSec?: unknown; stepSec?: unknown } }).clock;
  if (typeof clock?.durationSec !== "number" || typeof clock.stepSec !== "number") return null;
  return workloadStepCount(clock.durationSec, clock.stepSec);
}

type ScenarioBenchResult = {
  scenario: string;
  stats: {
    meanMs: number | null;
    minMs: number | null;
    maxMs: number | null;
    p95Ms: number | null;
  };
  pass: boolean;
  checks: {
    meanMs: boolean;
    p95Ms: boolean;
    baseline: boolean;
  };
  budget: PerformanceArtifact;
  comparison: ReturnType<typeof comparePerformanceBudgets> | null;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const host = currentHost();
  const bundled = ensureFreshBundle();
  const scenarioResults: ScenarioBenchResult[] = [];
  let baseline: PerformanceArtifact | null = null;
  if (args.baseline) {
    const parsed = readPerformanceArtifact(await Bun.file(resolve(ROOT, args.baseline)).json());
    if (!parsed) throw new Error("--baseline is not an idlekit.performance-budget artifact");
    baseline = parsed;
  }

  for (const scenario of args.scenarios) {
    const scenarioPath = resolveScenarioPath(scenario);
    const scenarioJson = await Bun.file(scenarioPath).json();
    const config = configFromScenario(scenarioJson);
    const prepareWarm: number[] = [];
    const runtime: number[] = [];
    const retained: number[] = [];
    let prepareCold: number | undefined;
    const beforeRuntime = { rss: 0, heap: 0 };
    let afterRuntime = { rss: 0, heap: 0 };

    for (let i = 0; i < 1 + args.warmup + args.iterations; i++) {
      if (i === 1 + args.warmup) {
        const usage = process.memoryUsage();
        beforeRuntime = { rss: usage.rss, heap: usage.heapUsed };
      }
      const start = performance.now();
      const output = runSimulateOnce(bundled, scenarioPath);
      const elapsed = performance.now() - start;
      if (i === 0) prepareCold = elapsed;
      else if (i <= args.warmup) prepareWarm.push(elapsed);
      else {
        runtime.push(elapsed);
        const samples = retainedOf(output);
        if (samples !== null) retained.push(samples);
      }
    }
    const usage = process.memoryUsage();
    afterRuntime = { rss: usage.rss, heap: usage.heapUsed };

    const meanMs = runtime.length ? runtime.reduce((a, b) => a + b, 0) / runtime.length : null;
    const p95Ms = percentile(runtime, 0.95);
    const passMean = meanMs !== null && meanMs <= args.thresholdMs;
    const passP95 = args.thresholdP95Ms === undefined ? true : p95Ms !== null && p95Ms <= args.thresholdP95Ms;
    const retainedMedian = median(retained);
    const budget = buildPerformanceArtifact({
      corpus: args.corpus,
      scenario: scenarioPath,
      config,
      host,
      iterations: args.iterations,
      warmup: args.warmup,
      workloadCount: workloadOf(scenarioJson),
      phases: {
        prepareColdMs: prepareCold,
        prepareWarmMs: prepareWarm,
        runtimeMs: runtime,
      },
      retainedSamples: retainedMedian,
      rssDeltaBytes: afterRuntime.rss - beforeRuntime.rss,
      heapDeltaBytes: afterRuntime.heap - beforeRuntime.heap,
    });
    let comparison: ScenarioBenchResult["comparison"] = null;
    let baselinePass = true;
    if (baseline) {
      comparison = comparePerformanceBudgets(baseline, budget, {
        minIterations: args.minIterations,
        relativeSlowdown: args.relativeSlowdown,
        absoluteMedianMs: args.absoluteMedianMs,
      }, () => {
        throw new Error("performance baseline rewrite is disabled");
      });
      baselinePass = comparison.status === "pass";
    }
    scenarioResults.push({
      scenario: scenarioPath,
      stats: {
        meanMs,
        minMs: runtime.length ? Math.min(...runtime) : null,
        maxMs: runtime.length ? Math.max(...runtime) : null,
        p95Ms,
      },
      pass: passMean && passP95 && baselinePass,
      checks: { meanMs: passMean, p95Ms: passP95, baseline: baselinePass },
      budget,
      comparison,
    });
  }

  const rssValues = scenarioResults.map((result) => result.budget.metrics.rssDeltaBytes);
  const rssDelta = rssValues.every((metric) => metric.status === "measured")
    ? rssValues.reduce((sum, metric) => sum + (metric.status === "measured" ? metric.value : 0), 0)
    : null;
  const memoryPass = args.thresholdRssDeltaBytes === undefined
    ? true
    : rssDelta !== null && rssDelta <= args.thresholdRssDeltaBytes;
  const overallPass = scenarioResults.every((item) => item.pass);
  const result = {
    contract: "idlekit.performance-budget",
    schemaVersion: 1,
    corpus: args.corpus,
    host,
    scenarios: args.scenarios.map(resolveScenarioPath),
    iterations: args.iterations,
    warmup: args.warmup,
    threshold: {
      meanMs: args.thresholdMs,
      p95Ms: args.thresholdP95Ms,
      rssDeltaBytes: args.thresholdRssDeltaBytes,
      relativeSlowdown: args.relativeSlowdown,
      absoluteMedianMs: args.absoluteMedianMs,
      minIterations: args.minIterations,
    },
    perScenario: scenarioResults,
    memory: {
      rssDelta,
      pass: memoryPass,
    },
    pass: overallPass && memoryPass,
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(json);
  if (args.out) {
    const outPath = resolve(ROOT, args.out);
    await ensureDir(dirname(outPath));
    await Bun.write(outPath, json);
  }
  if (args.assert && !(overallPass && memoryPass)) process.exit(2);
}

if (import.meta.main) await main();
