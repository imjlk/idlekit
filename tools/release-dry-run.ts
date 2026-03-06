import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const packages = ["packages/money", "packages/core", "packages/cli"];

const results = packages.map((pkg) => {
  const cwd = resolve(root, pkg);
  const raw = execFileSync("npm", ["pack", "--json"], {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as unknown;
  return {
    packageDir: cwd,
    pack: parsed,
  };
});

const out = {
  generatedAt: new Date().toISOString(),
  results,
};

const outPath = resolve(root, "tmp", "release-dry-run.json");
mkdirSync(resolve(root, "tmp"), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`release dry-run wrote ${outPath}`);
