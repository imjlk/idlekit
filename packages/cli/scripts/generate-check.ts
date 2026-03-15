import { $ } from "bun";
import { resolve } from "path";

const CLI_ROOT = resolve(import.meta.dir, "..");
const TARGET = resolve(CLI_ROOT, ".bunli/commands.gen.ts");
const TEMP = resolve(CLI_ROOT, ".bunli/commands.gen.check.ts");

function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n").trimEnd();
}

async function main() {
  const proc = Bun.spawnSync(
    ["./node_modules/.bin/bunli", "generate", "--entry", "src/main.ts", "--output", TEMP],
    {
      cwd: CLI_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  );

  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || proc.stdout.toString() || "bunli generate failed");
  }

  const current = normalize(await Bun.file(TARGET).text());
  const next = normalize(await Bun.file(TEMP).text());

  await $`rm -f ${TEMP}`.quiet();

  if (current !== next) {
    throw new Error("Generated Bunli metadata is stale. Run `bun run --cwd packages/cli generate`.");
  }
}

await main();
