import { $ } from "bun";
import { resolve } from "path";
import { parseNpmPackEntries } from "./npm-pack";

const root = process.cwd();
const packages = ["packages/money", "packages/core", "packages/cli"];

function parsePackOutput(raw: string): unknown {
  return parseNpmPackEntries(raw);
}

// Pack one package at a time. Each prepack rewrites its own package.json between build and
// postpack, and the next package's ttsc build reads that manifest, so concurrent packs fail
// with TtscUnstableGenerationError.
const results: { packageDir: string; pack: unknown }[] = [];
for (const pkg of packages) {
  const cwd = resolve(root, pkg);
  const raw = await $`npm pack --json`.cwd(cwd).text();
  results.push({ packageDir: cwd, pack: parsePackOutput(raw) });
}

const out = {
  generatedAt: new Date().toISOString(),
  results,
};

const outPath = resolve(root, "tmp", "release-dry-run.json");
await $`mkdir -p ${resolve(root, "tmp")}`.quiet();
await Bun.write(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`release dry-run wrote ${outPath}`);
