import { $ } from "bun";
import { resolve } from "path";

const root = process.cwd();
const packages = ["packages/money", "packages/core", "packages/cli"];

function parsePackOutput(raw: string): unknown {
  const match = raw.match(/(\[\s*{[\s\S]*}\s*\])\s*$/);
  if (!match) {
    throw new Error(`npm pack output did not include JSON payload:\n${raw}`);
  }
  return JSON.parse(match[1]) as unknown;
}

const results = await Promise.all(
  packages.map(async (pkg) => {
    const cwd = resolve(root, pkg);
    const raw = await $`npm pack --json`.cwd(cwd).text();
    return {
      packageDir: cwd,
      pack: parsePackOutput(raw),
    };
  }),
);

const out = {
  generatedAt: new Date().toISOString(),
  results,
};

const outPath = resolve(root, "tmp", "release-dry-run.json");
await $`mkdir -p ${resolve(root, "tmp")}`.quiet();
await Bun.write(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`release dry-run wrote ${outPath}`);
