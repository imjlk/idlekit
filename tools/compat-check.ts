import { resolve } from "path";
import { ROOT, ensureDir, runText, writeText } from "./_bun";

type Step = Readonly<{
  name: string;
  cwd: string;
  args: string[];
}>;

// `bun run test <file>` still executes the package script `bun test src`, so the
// extra path does not narrow the run. Call bun test on the fixture files directly.
const STEPS: readonly Step[] = [
  {
    name: "core sim-state compatibility",
    cwd: resolve(ROOT, "packages/core"),
    args: ["bun", "test", "src/serde/simState.compat.test.ts"],
  },
  {
    name: "cli fixture compatibility",
    cwd: resolve(ROOT, "packages/cli"),
    args: [
      "bun",
      "test",
      "--timeout",
      "90000",
      "src/commands/compat-fixtures.test.ts",
      "src/io/outputMeta.compat.test.ts",
    ],
  },
] as const;

async function main(): Promise<void> {
  const results: Array<{ name: string; ok: boolean }> = [];
  for (const step of STEPS) {
    console.log(`==> ${step.name}`);
    runText(step.args, { cwd: step.cwd, env: process.env });
    results.push({ name: step.name, ok: true });
  }

  const outPath = resolve(ROOT, "tmp", "compat-check.json");
  await ensureDir(resolve(ROOT, "tmp"));
  await writeText(outPath, `${JSON.stringify({ ok: true, steps: results }, null, 2)}\n`);
  console.log(`compat check passed: ${outPath}`);
}

await main();
