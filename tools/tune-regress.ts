import { resolve } from "path";

type Args = Readonly<{
  baseline: string;
  current: string;
  tolerance: number;
}>;

function parseArgs(argv: string[]): Args {
  let baseline = "";
  let current = "";
  let tolerance = 0;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") baseline = argv[++i] ?? "";
    else if (a === "--current") current = argv[++i] ?? "";
    else if (a === "--tolerance") tolerance = Number(argv[++i] ?? "0");
  }

  if (!baseline || !current) {
    throw new Error("Usage: bun tools/tune-regress.ts --baseline <artifact.json> --current <artifact.json> [--tolerance 0]");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("--tolerance must be a finite number >= 0");
  }

  return { baseline, current, tolerance };
}

function readBestScore(artifact: unknown, label: string): number {
  const score = (artifact as any)?.result?.report?.best?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error(`${label} artifact is invalid: result.report.best.score(number) is required`);
  }
  return score;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const baselinePath = resolve(args.baseline);
  const currentPath = resolve(args.current);

  const baseline = await Bun.file(baselinePath).json();
  const current = await Bun.file(currentPath).json();

  const baselineScore = readBestScore(baseline, "baseline");
  const currentScore = readBestScore(current, "current");
  const delta = currentScore - baselineScore;
  const deltaPct = baselineScore === 0 ? (delta === 0 ? 0 : Number.POSITIVE_INFINITY) : (delta / baselineScore) * 100;
  const regressed = currentScore + args.tolerance < baselineScore;

  const out = {
    baselinePath,
    currentPath,
    baselineScore,
    currentScore,
    delta,
    deltaPct,
    tolerance: args.tolerance,
    regressed,
  };

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (regressed) {
    process.exit(2);
  }
}

await main();
