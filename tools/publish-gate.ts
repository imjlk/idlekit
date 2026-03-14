import { resolve } from "path";
import { ROOT, ensureDir, runText, writeText } from "./_bun";

const STEPS = [
  "typecheck",
  "runtime:check",
  "test",
  "build",
  "docs:verify",
  "templates:check",
  "install:smoke",
  "public:check",
  "replay:verify",
  "kpi:report",
  "kpi:regress",
  "release:plan",
] as const;

type StepName = (typeof STEPS)[number];

type StepResult = Readonly<{
  name: StepName;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}>;

async function main(): Promise<void> {
  const results: StepResult[] = [];
  for (const step of STEPS) {
    const startedAt = new Date();
    console.log(`==> ${step}`);
    runText(["bun", "run", step], { cwd: ROOT, env: process.env });
    const finishedAt = new Date();
    results.push({
      name: step,
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
  }

  const outPath = resolve(ROOT, "tmp", "publish-gate.json");
  await ensureDir(resolve(ROOT, "tmp"));
  await writeText(
    outPath,
    `${JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), steps: results }, null, 2)}\n`,
  );
  console.log(`publish gate passed: ${outPath}`);
}

await main();
