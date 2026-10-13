import { existsSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";
import { ROOT, ensureDir } from "./_bun";
import {
  buildPerformanceArtifact,
  comparePerformanceBudgets,
  currentHost,
  benchConfigFromScenario,
  percentile,
  mergeBaselines,
  readBaselineArtifacts,
  scenarioHash,
  scenarioWorkload,
  selectBaseline,
  type EffectiveRun,
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
  thresholdPeakRssBytes?: number;
  prepareWarm: number;
  assert: boolean;
  out?: string;
  writeBaseline?: string;
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
  let thresholdPeakRssBytes: number | undefined;
  let prepareWarm = 1;
  let assert = false;
  let out: string | undefined;
  let writeBaseline: string | undefined;
  let baseline: string | undefined;
  let corpus: "representative" | "long" = "representative";
  let relativeSlowdown = 0.25;
  let absoluteMedianMs = thresholdMs;
  let minIterations = iterations;
  let absoluteSet = false;
  let minSet = false;

  let i = 2;
  // A flag that takes a value fails without one. A misspelled flag fails, so it cannot drop a gate input.
  const take = (flag: string): string => {
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario") scenarios = [take(a)];
    else if (a === "--scenarios") scenarios = take(a).split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--iterations") iterations = Number(take(a));
    else if (a === "--warmup") warmup = Number(take(a));
    else if (a === "--threshold-ms") thresholdMs = Number(take(a));
    else if (a === "--threshold-p95-ms") thresholdP95Ms = Number(take(a));
    else if (a === "--threshold-peak-rss-bytes") thresholdPeakRssBytes = Number(take(a));
    else if (a === "--prepare-warm") prepareWarm = Number(take(a));
    else if (a === "--assert") assert = true;
    else if (a === "--out") out = take(a);
    else if (a === "--write-baseline") writeBaseline = take(a);
    else if (a === "--baseline") baseline = take(a);
    else if (a === "--corpus") {
      const value = take(a);
      if (value !== "representative" && value !== "long") throw new Error("--corpus must be representative or long");
      corpus = value;
    } else if (a === "--relative") relativeSlowdown = Number(take(a));
    else if (a === "--absolute-median-ms") {
      absoluteMedianMs = Number(take(a));
      absoluteSet = true;
    } else if (a === "--min-iterations") {
      minIterations = Number(take(a));
      minSet = true;
    } else throw new Error(`unknown flag: ${a}`);
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
    thresholdPeakRssBytes !== undefined &&
    (!Number.isFinite(thresholdPeakRssBytes) || thresholdPeakRssBytes <= 0)
  ) {
    throw new Error("--threshold-peak-rss-bytes must be a finite number > 0");
  }
  if (!Number.isInteger(prepareWarm) || prepareWarm < 0) throw new Error("--prepare-warm must be an integer >= 0");
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
    thresholdPeakRssBytes,
    prepareWarm,
    assert,
    out,
    writeBaseline,
    baseline,
    corpus,
    relativeSlowdown,
    absoluteMedianMs,
    minIterations,
  };
}

function resolveScenarioPath(input: string): string {
  return isAbsolute(input) ? input : resolve(REPO_ROOT, input);
}

/**
 * Compiler prepare: the ttsc bundle build of the CLI. The runtime samples then
 * run that bundle. Caches left by earlier commands are not cleared, so cold is
 * the first prepare in this bench process.
 */
function prepareBundle(): { bundled: string; durationMs: number } {
  const bundled = resolve(CLI_ROOT, "dist/main.js");
  const start = performance.now();
  const proc = Bun.spawnSync(["bun", "scripts/cli-bundle.ts", "--outdir", "dist", "--sourcemap"], {
    cwd: CLI_ROOT,
    stdout: "ignore",
    stderr: "inherit",
    env: process.env,
  });
  const durationMs = performance.now() - start;
  if ((proc.exitCode ?? 1) !== 0 || !existsSync(bundled)) {
    throw new Error("simulate benchmark could not build packages/cli/dist/main.js");
  }
  return { bundled, durationMs };
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

/** One simulate child. Peak RSS is the child's own, not the bench harness. */
function runSimulateOnce(
  bundled: string,
  scenarioPath: string,
): { engine: string | null; seed: number | null; peakRssBytes: number | null } {
  // --config skips the CLI bunfig preload, which would rebuild the ttsc
  // program in every child. Compiler prepare is measured by prepareBundle.
  const proc = Bun.spawnSync(
    ["bun", `--config=${resolve(REPO_ROOT, "tools/bench-bunfig.toml")}`, bundled, "simulate", scenarioPath, "--format", "json"],
    { cwd: CLI_ROOT, env: process.env, stdout: "pipe", stderr: "pipe", maxBuffer: MAX_CAPTURE_BYTES },
  );
  if (proc.exitCode !== 0) {
    const detail = proc.stderr.toString().trim() || proc.stdout.toString().trim();
    throw new Error(detail || `simulate benchmark failed with exit code ${proc.exitCode}`);
  }
  const output: unknown = JSON.parse(proc.stdout.toString());
  if (!output || typeof output !== "object") throw new Error("simulate benchmark returned non-object output");
  const maxRss = proc.resourceUsage?.maxRSS;
  const meta = (output as { _meta?: { effectiveEngine?: unknown; seed?: unknown } })._meta;
  return {
    engine: typeof meta?.effectiveEngine === "string" ? meta.effectiveEngine : null,
    seed: typeof meta?.seed === "number" && Number.isFinite(meta.seed) ? meta.seed : null,
    peakRssBytes: typeof maxRss === "number" && Number.isFinite(maxRss) && maxRss > 0 ? maxRss : null,
  };
}

function scenarioLabel(scenarioPath: string): string {
  const rel = relative(REPO_ROOT, scenarioPath);
  return rel.startsWith("..") || isAbsolute(rel) ? scenarioPath : rel;
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
    peakRssBytes: boolean;
    baseline: boolean;
  };
  budget: PerformanceArtifact;
  comparison: ReturnType<typeof comparePerformanceBudgets> | null;
};

/**
 * Replace this host's entries for the measured scenarios and keep the other hosts' entries.
 * Only this explicit flag writes a baseline. A comparison never does.
 */
async function writeBaselineFile(path: string, results: readonly ScenarioBenchResult[]): Promise<void> {
  const file = Bun.file(path);
  const existing = (await file.exists()) ? readBaselineArtifacts(await file.json()) : [];
  if (!existing) throw new Error(`--write-baseline ${path} is not a baseline file`);
  const merged = mergeBaselines(existing, results.map((item) => item.budget));
  const perScenario = merged.map((budget) => ({ scenario: budget.scenario, budget }));
  await ensureDir(dirname(path));
  await Bun.write(path, `${JSON.stringify({ contract: "idlekit.performance-budget", schemaVersion: 1, perScenario }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const host = currentHost();
  let baselines: PerformanceArtifact[] | null = null;
  if (args.baseline) {
    baselines = readBaselineArtifacts(await Bun.file(resolve(ROOT, args.baseline)).json());
    if (!baselines) throw new Error("--baseline is not an idlekit.performance-budget artifact or bench-sim output");
  }
  const cold = prepareBundle();
  const prepareWarm: number[] = [];
  for (let i = 0; i < args.prepareWarm; i++) prepareWarm.push(prepareBundle().durationMs);
  const bundled = cold.bundled;
  const scenarioResults: ScenarioBenchResult[] = [];

  for (const scenario of args.scenarios) {
    const scenarioPath = resolveScenarioPath(scenario);
    const scenarioJson: unknown = await Bun.file(scenarioPath).json();
    const runtime: number[] = [];
    const peakRss: number[] = [];
    const effective = new Set<string>();

    // Warmup children are discarded. They are simulate runs, not compiler prepare.
    for (let i = 0; i < args.warmup + args.iterations; i++) {
      const start = performance.now();
      const run = runSimulateOnce(bundled, scenarioPath);
      const elapsed = performance.now() - start;
      effective.add(JSON.stringify({ engine: run.engine ?? "unknown", seed: run.seed }));
      if (i < args.warmup) continue;
      runtime.push(elapsed);
      if (run.peakRssBytes !== null) peakRss.push(run.peakRssBytes);
    }

    // The run's effective engine and seed, not scenario.engine, which simulate records as metadata only.
    if (effective.size !== 1) throw new Error(`simulate reported more than one engine or seed: ${[...effective].join(", ")}`);
    const config = benchConfigFromScenario(scenarioJson, JSON.parse([...effective][0] ?? "{}") as EffectiveRun);
    const meanMs = runtime.length ? runtime.reduce((a, b) => a + b, 0) / runtime.length : null;
    const p95Ms = percentile(runtime, 0.95);
    const passMean = meanMs !== null && meanMs <= args.thresholdMs;
    const passP95 = args.thresholdP95Ms === undefined ? true : p95Ms !== null && p95Ms <= args.thresholdP95Ms;
    const peakRssBytes = peakRss.length === runtime.length && peakRss.length > 0 ? Math.max(...peakRss) : null;
    const passPeakRss = args.thresholdPeakRssBytes === undefined
      ? true
      : peakRssBytes !== null && peakRssBytes <= args.thresholdPeakRssBytes;
    const budget = buildPerformanceArtifact({
      corpus: args.corpus,
      scenario: scenarioLabel(scenarioPath),
      scenarioHash: scenarioHash(scenarioJson),
      config,
      host,
      iterations: args.iterations,
      warmup: args.warmup,
      workloadCount: scenarioWorkload(scenarioJson),
      phases: {
        prepareColdMs: cold.durationMs,
        prepareWarmMs: prepareWarm,
        runtimeMs: runtime,
      },
      peakRssBytes,
    });
    let comparison: ScenarioBenchResult["comparison"] = null;
    let baselinePass = true;
    if (baselines) {
      const baseline = selectBaseline(baselines, budget);
      comparison = baseline
        ? comparePerformanceBudgets(baseline, budget, {
          minIterations: args.minIterations,
          relativeSlowdown: args.relativeSlowdown,
          absoluteMedianMs: args.absoluteMedianMs,
        }, () => {
          throw new Error("performance baseline rewrite is disabled");
        })
        : { status: "rejected", reason: "workload-mismatch" };
      baselinePass = comparison.status === "pass";
    }
    scenarioResults.push({
      scenario: scenarioLabel(scenarioPath),
      stats: {
        meanMs,
        minMs: runtime.length ? Math.min(...runtime) : null,
        maxMs: runtime.length ? Math.max(...runtime) : null,
        p95Ms,
      },
      pass: passMean && passP95 && passPeakRss && baselinePass,
      checks: { meanMs: passMean, p95Ms: passP95, peakRssBytes: passPeakRss, baseline: baselinePass },
      budget,
      comparison,
    });
  }

  const overallPass = scenarioResults.every((item) => item.pass);
  const result = {
    contract: "idlekit.performance-budget",
    schemaVersion: 1,
    corpus: args.corpus,
    host,
    scenarios: args.scenarios.map((item) => scenarioLabel(resolveScenarioPath(item))),
    iterations: args.iterations,
    warmup: args.warmup,
    threshold: {
      meanMs: args.thresholdMs,
      p95Ms: args.thresholdP95Ms,
      peakRssBytes: args.thresholdPeakRssBytes,
      relativeSlowdown: args.relativeSlowdown,
      absoluteMedianMs: args.absoluteMedianMs,
      minIterations: args.minIterations,
    },
    prepare: { coldMs: cold.durationMs, warmMs: prepareWarm },
    perScenario: scenarioResults,
    pass: overallPass,
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(json);
  if (args.out) {
    const outPath = resolve(ROOT, args.out);
    await ensureDir(dirname(outPath));
    await Bun.write(outPath, json);
  }
  if (args.writeBaseline) await writeBaselineFile(resolve(ROOT, args.writeBaseline), scenarioResults);
  if (args.assert && !overallPass) process.exit(2);
}

if (import.meta.main) await main();
