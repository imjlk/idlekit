import { dirname, resolve } from "path";
import { ROOT, createTempDir, ensureDir, removePath, runJson, sha256Hex, writeText } from "./_bun";

type Args = Readonly<{
  scenarioA: string;
  scenarioB: string;
  plugin?: string;
  pluginRoot?: string;
  out?: string;
}>;

function parseArgs(argv: string[]): Args {
  let scenarioA = "examples/tutorials/14-orbital-foundry-v1.json";
  let scenarioB = "examples/tutorials/15-orbital-foundry-compare-b.json";
  let plugin = "examples/plugins/custom-econ-plugin.ts";
  let pluginRoot = "examples/plugins";
  let out: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--a") scenarioA = argv[++i] ?? scenarioA;
    else if (a === "--b") scenarioB = argv[++i] ?? scenarioB;
    else if (a === "--plugin") plugin = argv[++i] ?? plugin;
    else if (a === "--plugin-root") pluginRoot = argv[++i] ?? pluginRoot;
    else if (a === "--out") out = argv[++i];
  }

  return { scenarioA, scenarioB, plugin, pluginRoot, out };
}

function runCliJson(args: string[]): any {
  return runJson(["bun", "run", "--cwd", "packages/cli", "dev", "--", ...args], { cwd: ROOT });
}

function relativizeRepoPaths(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith(`${ROOT}/`)) {
      return value.slice(ROOT.length + 1);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => relativizeRepoPaths(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key.startsWith(`${ROOT}/`) ? key.slice(ROOT.length + 1) : key,
        relativizeRepoPaths(entry),
      ]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const scenarioAAbs = resolve(args.scenarioA);
  const scenarioBAbs = resolve(args.scenarioB);
  const pluginAbs = args.plugin ? resolve(args.plugin) : undefined;
  const pluginRootAbs = args.pluginRoot ? resolve(args.pluginRoot) : undefined;
  const pluginDigest = pluginAbs ? sha256Hex(await Bun.file(pluginAbs).bytes()) : undefined;
  const pluginSha = pluginAbs && pluginDigest ? `${pluginAbs}=${pluginDigest}` : undefined;
  const trustDir = pluginAbs ? await createTempDir("idlekit-kpi-trust") : undefined;
  const trustFile = trustDir ? resolve(trustDir, "plugin-trust.json") : undefined;
  if (trustFile && pluginAbs) {
    await writeText(trustFile, `${JSON.stringify({ plugins: { [pluginAbs]: pluginDigest } }, null, 2)}\n`);
  }

  const pluginFlags = pluginAbs
    ? [
        "--plugin",
        pluginAbs,
        "--allow-plugin",
        "true",
        "--plugin-root",
        pluginRootAbs ?? resolve("."),
        "--plugin-sha256",
        pluginSha!,
        "--plugin-trust-file",
        trustFile!,
      ]
    : [];

  try {
    const compareNetWorth = runCliJson([
      "compare",
      scenarioAAbs,
      scenarioBAbs,
      "--metric",
      "endNetWorth",
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const compareEta = runCliJson([
      "compare",
      scenarioAAbs,
      scenarioBAbs,
      "--metric",
      "etaToTargetWorth",
      "--target-worth",
      "1e6",
      "--max-duration",
      "86400",
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const compareVisible = runCliJson([
      "compare",
      scenarioAAbs,
      scenarioBAbs,
      "--metric",
      "visibleChangesPerMinute",
      "--session-pattern",
      "twice-daily",
      "--days",
      "7",
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const compareMilestone = runCliJson([
      "compare",
      scenarioAAbs,
      scenarioBAbs,
      "--metric",
      "timeToMilestone",
      "--milestone-key",
      "progress.first-upgrade",
      "--session-pattern",
      "twice-daily",
      "--days",
      "7",
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const ltvA = runCliJson([
      "ltv",
      scenarioAAbs,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const ltvB = runCliJson([
      "ltv",
      scenarioBAbs,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const experienceA = runCliJson([
      "experience",
      scenarioAAbs,
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const experienceB = runCliJson([
      "experience",
      scenarioBAbs,
      ...pluginFlags,
      "--format",
      "json",
    ]);

    const report = relativizeRepoPaths({
      generatedAt: new Date().toISOString(),
      input: {
        a: scenarioAAbs,
        b: scenarioBAbs,
        plugin: pluginAbs,
      },
      compare: {
        endNetWorth: compareNetWorth,
        etaToTargetWorth: compareEta,
        visibleChangesPerMinute: compareVisible,
        timeToFirstUpgrade: compareMilestone,
      },
      ltv: {
        a: {
          summary: ltvA.summary,
          meta: ltvA._meta,
        },
        b: {
          summary: ltvB.summary,
          meta: ltvB._meta,
        },
      },
      experience: {
        a: {
          end: experienceA.end,
          session: experienceA.session,
          milestones: experienceA.milestones,
          perceived: experienceA.perceived,
          growth: experienceA.growth,
          meta: experienceA._meta,
        },
        b: {
          end: experienceB.end,
          session: experienceB.session,
          milestones: experienceB.milestones,
          perceived: experienceB.perceived,
          growth: experienceB.growth,
          meta: experienceB._meta,
        },
      },
    });

    const json = `${JSON.stringify(report, null, 2)}\n`;

    if (args.out) {
      const outPath = resolve(args.out);
      await ensureDir(dirname(outPath));
      await Bun.write(outPath, json);
      process.stdout.write(`wrote kpi report: ${outPath}\n`);
      return;
    }

    process.stdout.write(json);
  } finally {
    if (trustDir) {
      await removePath(trustDir);
    }
  }
}

await main();
