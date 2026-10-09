import { $ } from "bun";
import { resolve } from "path";
import { parseNpmPackEntries } from "./npm-pack";

const root = process.cwd();
const packages = ["packages/money", "packages/core", "packages/cli"];

function parsePackOutput(raw: string): unknown {
  return parseNpmPackEntries(raw);
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
