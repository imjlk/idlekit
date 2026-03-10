import { resolve } from "path";
import { ROOT, ensureDir, readText, removePath, runJson, sha256Hex, writeText } from "./_bun";

const TMP_DIR = resolve(ROOT, "tmp", "replay-verify-gate");

function runCliFromRoot(args: string[]): unknown {
  return runJson(["bun", "packages/cli/src/main.ts", ...args], { cwd: ROOT });
}

function runCliDevJson(args: string[]): Record<string, unknown> {
  return runJson(["bun", "run", "--cwd", "packages/cli", "dev", "--", ...args], { cwd: ROOT }) as Record<
    string,
    unknown
  >;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  await removePath(TMP_DIR);
  await ensureDir(TMP_DIR);

  const baseline = "examples/tutorials/01-cafe-baseline.json";
  const compareB = "examples/tutorials/03-cafe-compare-b.json";
  const tuneSpec = "examples/tutorials/04-cafe-tune.json";
  const plugin = "examples/plugins/custom-econ-plugin.ts";
  const pluginRoot = "examples/plugins";
  const pluginAbs = resolve(ROOT, plugin);
  const sha = sha256Hex(await readText(pluginAbs));
  const pluginShaArg = `${plugin}=${sha}`;
  const trustFile = resolve(TMP_DIR, "plugin-trust.json");
  await writeText(trustFile, `${JSON.stringify({ plugins: { [pluginAbs]: sha } }, null, 2)}\n`);

  const artifacts = {
    simulate: resolve(TMP_DIR, "simulate.artifact.json"),
    compare: resolve(TMP_DIR, "compare.artifact.json"),
    tune: resolve(TMP_DIR, "tune.artifact.json"),
    ltv: resolve(TMP_DIR, "ltv.artifact.json"),
  };

  const pluginFlags = [
    "--plugin",
    plugin,
    "--allow-plugin",
    "true",
    "--plugin-root",
    pluginRoot,
    "--plugin-sha256",
    pluginShaArg,
    "--plugin-trust-file",
    trustFile,
  ];

  runCliFromRoot([
    "simulate",
    baseline,
    ...pluginFlags,
    "--seed",
    "401",
    "--run-id",
    "gate-sim",
    "--artifact-out",
    artifacts.simulate,
    "--format",
    "json",
  ]);

  runCliFromRoot([
    "compare",
    baseline,
    compareB,
    "--metric",
    "endNetWorth",
    ...pluginFlags,
    "--seed",
    "402",
    "--run-id",
    "gate-compare",
    "--artifact-out",
    artifacts.compare,
    "--format",
    "json",
  ]);

  runCliFromRoot([
    "tune",
    baseline,
    "--tune",
    tuneSpec,
    ...pluginFlags,
    "--seed",
    "403",
    "--run-id",
    "gate-tune",
    "--artifact-out",
    artifacts.tune,
    "--format",
    "json",
  ]);

  runCliFromRoot([
    "ltv",
    baseline,
    "--horizons",
    "30m,2h,24h,7d,30d,90d",
    "--step",
    "600",
    ...pluginFlags,
    "--seed",
    "404",
    "--run-id",
    "gate-ltv",
    "--artifact-out",
    artifacts.ltv,
    "--format",
    "json",
  ]);

  for (const [command, artifact] of Object.entries(artifacts)) {
    const verified = runCliDevJson(["replay", "verify", artifact, "--format", "json"]);
    assert(verified.ok === true, `Replay verify failed for ${command}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        checked: Object.keys(artifacts),
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
