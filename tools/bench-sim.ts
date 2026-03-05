import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Args = Readonly<{
  scenario: string;
  iterations: number;
  warmup: number;
  thresholdMs: number;
  thresholdP95Ms?: number;
  assert: boolean;
  out?: string;
}>;

function parseArgs(argv: string[]): Args {
  let scenario = "examples/tutorials/01-cafe-baseline.json";
  let iterations = 7;
  let warmup = 2;
  let thresholdMs = 500;
  let thresholdP95Ms: number | undefined;
  let assert = false;
  let out: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario") scenario = argv[++i] ?? scenario;
    else if (a === "--iterations") iterations = Number(argv[++i] ?? iterations);
    else if (a === "--warmup") warmup = Number(argv[++i] ?? warmup);
    else if (a === "--threshold-ms") thresholdMs = Number(argv[++i] ?? thresholdMs);
    else if (a === "--threshold-p95-ms") thresholdP95Ms = Number(argv[++i] ?? thresholdP95Ms);
    else if (a === "--assert") assert = true;
    else if (a === "--out") out = argv[++i];
  }

  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("--iterations must be an integer > 0");
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new Error("--warmup must be an integer >= 0");
  }
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new Error("--threshold-ms must be a finite number > 0");
  }
  if (thresholdP95Ms !== undefined && (!Number.isFinite(thresholdP95Ms) || thresholdP95Ms <= 0)) {
    throw new Error("--threshold-p95-ms must be a finite number > 0");
  }

  return {
    scenario,
    iterations,
    warmup,
    thresholdMs,
    thresholdP95Ms,
    assert,
    out,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

function resolveScenarioPath(input: string): string {
  return isAbsolute(input) ? input : resolve(REPO_ROOT, input);
}

function runSimulateOnce(scenarioPath: string): void {
  const raw = execFileSync("bun", ["src/main.ts", "simulate", scenarioPath, "--format", "json"], {
    cwd: resolve(REPO_ROOT, "packages/cli"),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("simulate benchmark returned non-object output");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const scenarioPath = resolveScenarioPath(args.scenario);

  const samples: number[] = [];
  const memoryStart = process.memoryUsage().rss;

  for (let i = 0; i < args.warmup + args.iterations; i++) {
    const start = performance.now();
    runSimulateOnce(scenarioPath);
    const elapsed = performance.now() - start;
    if (i >= args.warmup) {
      samples.push(elapsed);
    }
  }

  const memoryEnd = process.memoryUsage().rss;
  const meanMs = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  const p95Ms = percentile(samples, 0.95);
  const passMean = meanMs <= args.thresholdMs;
  const passP95 = args.thresholdP95Ms === undefined ? true : p95Ms <= args.thresholdP95Ms;
  const result = {
    scenario: scenarioPath,
    iterations: args.iterations,
    warmup: args.warmup,
    threshold: {
      meanMs: args.thresholdMs,
      p95Ms: args.thresholdP95Ms,
    },
    stats: {
      meanMs,
      minMs: samples.length ? Math.min(...samples) : 0,
      maxMs: samples.length ? Math.max(...samples) : 0,
      p95Ms,
    },
    memory: {
      rssStart: memoryStart,
      rssEnd: memoryEnd,
      rssDelta: memoryEnd - memoryStart,
    },
    pass: passMean && passP95,
    checks: {
      meanMs: passMean,
      p95Ms: passP95,
    },
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(json);

  if (args.out) {
    await writeFile(resolve(args.out), json, "utf8");
  }

  if (args.assert && !result.pass) {
    process.exit(2);
  }
}

await main();
