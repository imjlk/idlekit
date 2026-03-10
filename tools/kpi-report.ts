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
  let scenarioA = "examples/tutorials/05-idle-design-v1.json";
  let scenarioB = "examples/tutorials/06-idle-design-balance-b.json";
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

    const report = {
      generatedAt: new Date().toISOString(),
      input: {
        a: scenarioAAbs,
        b: scenarioBAbs,
        plugin: pluginAbs,
      },
      compare: {
        endNetWorth: compareNetWorth,
        etaToTargetWorth: compareEta,
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
    };

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
