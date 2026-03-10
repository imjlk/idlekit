import { relative, resolve } from "path";

const ROOT = process.cwd();
const SCAN_GLOBS = [
  new Bun.Glob("packages/*/src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"),
  new Bun.Glob("tools/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"),
];
const NODE_IMPORT = /from\s+["']node:|require\(\s*["']node:/;

function isRuntimeSource(path: string): boolean {
  return !path.includes(".test.") && !path.includes("/testkit/") && !path.includes("\\testkit\\");
}

const offenders: string[] = [];

for (const glob of SCAN_GLOBS) {
  for await (const path of glob.scan({ cwd: ROOT, absolute: true })) {
    if (!isRuntimeSource(path)) continue;
    const body = await Bun.file(path).text();
    if (NODE_IMPORT.test(body)) {
      offenders.push(relative(ROOT, path));
    }
  }
}

if (offenders.length > 0) {
  console.error("[RUNTIME_NODE_IMPORT] Runtime source must prefer Bun APIs over `node:` imports.");
  for (const path of offenders) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log("runtime import check passed (packages + tools)");
