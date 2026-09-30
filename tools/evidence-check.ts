import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { checkInventory, expandGlob } from "./evidence-inventory";
import { commandText, root, runTtsc } from "./evidence-host";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const docs = await expandGlob("docs/requirements/active/**/*.md", root);
if (docs.length === 0) {
  console.error("active requirement docs are missing");
  process.exit(1);
}

console.log("evidence input hashes");
for (const rel of docs) {
  console.log(`${rel} ${sha256(readFileSync(join(root, rel), "utf8"))}`);
}
for (const rel of ["evidence.config.ts", "lint.config.ts", "docs/requirements/inventory.json"]) {
  console.log(`${rel} ${sha256(readFileSync(join(root, rel), "utf8"))}`);
}

const version = runTtsc(["version"], root);
process.stdout.write(version.stdout);
process.stderr.write(version.stderr);
if (version.exitCode !== 0) process.exit(version.exitCode);

const paths = runTtsc(
  ["cache", "paths", "--json", "-p", "tsconfig.evidence.json", "--cwd", root],
  root,
);
process.stdout.write(paths.stdout);
process.stderr.write(paths.stderr);
if (paths.exitCode !== 0) process.exit(paths.exitCode);

const checked = runTtsc(["-p", "tsconfig.evidence.json", "--noEmit", "--cwd", root], root);
process.stdout.write(checked.stdout);
process.stderr.write(checked.stderr);
console.log(`evidence:check ttsc exit ${checked.exitCode}`);
if (checked.exitCode !== 0) {
  console.error(commandText(checked).slice(0, 4000));
  process.exit(checked.exitCode);
}

const failures = await checkInventory(root);
if (failures.length > 0) {
  for (const message of failures) console.error(message);
  process.exit(1);
}

console.log("evidence:check passed");
