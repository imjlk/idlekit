import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Args = Readonly<{
  baseline: string;
  current: string;
  minWorthRatio: number;
  maxStallDelta: number;
  maxDroppedDelta: number;
  out?: string;
}>;

type Side = "a" | "b";
type Horizon = "at7d" | "at30d" | "at90d";

function parseArgs(argv: string[]): Args {
  let baseline = "examples/bench/kpi-baseline.json";
  let current = "tmp/kpi-report.json";
  let minWorthRatio = 0.97;
  let maxStallDelta = 0.03;
  let maxDroppedDelta = 0.03;
  let out: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") baseline = argv[++i] ?? baseline;
    else if (a === "--current") current = argv[++i] ?? current;
    else if (a === "--min-worth-ratio") minWorthRatio = Number(argv[++i] ?? minWorthRatio);
    else if (a === "--max-stall-delta") maxStallDelta = Number(argv[++i] ?? maxStallDelta);
    else if (a === "--max-dropped-delta") maxDroppedDelta = Number(argv[++i] ?? maxDroppedDelta);
    else if (a === "--out") out = argv[++i];
  }

  if (!Number.isFinite(minWorthRatio) || minWorthRatio <= 0) {
    throw new Error("--min-worth-ratio must be a finite number > 0");
  }
  if (!Number.isFinite(maxStallDelta) || maxStallDelta < 0) {
    throw new Error("--max-stall-delta must be a finite number >= 0");
  }
  if (!Number.isFinite(maxDroppedDelta) || maxDroppedDelta < 0) {
    throw new Error("--max-dropped-delta must be a finite number >= 0");
  }

  return {
    baseline,
    current,
    minWorthRatio,
    maxStallDelta,
    maxDroppedDelta,
    out,
  };
}

function toLog10(value: unknown): number {
  if (typeof value === "number") {
    if (value <= 0) return Number.NEGATIVE_INFINITY;
    return Math.log10(value);
  }
  if (typeof value !== "string") {
    throw new Error(`Expected numeric string, got ${typeof value}`);
  }

  const s = value.trim().toLowerCase();
  if (!s || s === "0") return Number.NEGATIVE_INFINITY;

  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 0) return Math.log10(asNum);

  const sci = s.match(/^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/);
  if (sci) {
    const m = Number(sci[1] ?? "");
    const e = Number(sci[2] ?? "");
    if (!Number.isFinite(m) || !Number.isFinite(e) || m <= 0) {
      throw new Error(`Invalid numeric string: ${value}`);
    }
    return Math.log10(m) + e;
  }

  throw new Error(`Unsupported numeric string: ${value}`);
}

function readHorizon(report: any, side: Side, horizon: Horizon): any {
  const row = report?.ltv?.[side]?.summary?.[horizon];
  if (!row || typeof row !== "object") {
    throw new Error(`Missing horizon '${horizon}' for side '${side}'`);
  }
  return row;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const baselinePath = resolve(args.baseline);
  const currentPath = resolve(args.current);
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const current = JSON.parse(await readFile(currentPath, "utf8"));

  const horizons: Horizon[] = ["at7d", "at30d", "at90d"];
  const sides: Side[] = ["a", "b"];
  const checks: Array<{
    side: Side;
    horizon: Horizon;
    baseline: {
      endNetWorth: string;
      stallRatio: number;
      droppedRate: number;
    };
    current: {
      endNetWorth: string;
      stallRatio: number;
      droppedRate: number;
    };
    deltas: {
      endWorthLog10: number;
      stallRatio: number;
      droppedRate: number;
    };
    thresholds: {
      minWorthLog10Delta: number;
      maxStallDelta: number;
      maxDroppedDelta: number;
    };
    pass: {
      worth: boolean;
      stallRatio: boolean;
      droppedRate: boolean;
      overall: boolean;
    };
  }> = [];

  const minWorthLog10Delta = Math.log10(args.minWorthRatio);
  for (const side of sides) {
    for (const horizon of horizons) {
      const b = readHorizon(baseline, side, horizon);
      const c = readHorizon(current, side, horizon);
      const bWorth = String(b.endNetWorth ?? "");
      const cWorth = String(c.endNetWorth ?? "");
      const bStall = Number(b.guardrails?.stallRatio ?? 0);
      const cStall = Number(c.guardrails?.stallRatio ?? 0);
      const bDropped = Number(b.guardrails?.droppedRate ?? 0);
      const cDropped = Number(c.guardrails?.droppedRate ?? 0);

      const worthDeltaLog10 = toLog10(cWorth) - toLog10(bWorth);
      const stallDelta = cStall - bStall;
      const droppedDelta = cDropped - bDropped;

      const worthPass = worthDeltaLog10 >= minWorthLog10Delta;
      const stallPass = stallDelta <= args.maxStallDelta;
      const droppedPass = droppedDelta <= args.maxDroppedDelta;

      checks.push({
        side,
        horizon,
        baseline: {
          endNetWorth: bWorth,
          stallRatio: bStall,
          droppedRate: bDropped,
        },
        current: {
          endNetWorth: cWorth,
          stallRatio: cStall,
          droppedRate: cDropped,
        },
        deltas: {
          endWorthLog10: worthDeltaLog10,
          stallRatio: stallDelta,
          droppedRate: droppedDelta,
        },
        thresholds: {
          minWorthLog10Delta,
          maxStallDelta: args.maxStallDelta,
          maxDroppedDelta: args.maxDroppedDelta,
        },
        pass: {
          worth: worthPass,
          stallRatio: stallPass,
          droppedRate: droppedPass,
          overall: worthPass && stallPass && droppedPass,
        },
      });
    }
  }

  const pass = checks.every((x) => x.pass.overall);
  const summary = {
    baselinePath,
    currentPath,
    generatedAt: new Date().toISOString(),
    thresholds: {
      minWorthRatio: args.minWorthRatio,
      maxStallDelta: args.maxStallDelta,
      maxDroppedDelta: args.maxDroppedDelta,
    },
    pass,
    checks,
  };
  const json = `${JSON.stringify(summary, null, 2)}\n`;

  if (args.out) {
    const outPath = resolve(args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, json, "utf8");
  }

  process.stdout.write(json);
  if (!pass) process.exit(2);
}

await main();
