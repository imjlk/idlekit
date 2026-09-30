import { relative, resolve } from "path";

const ROOT = process.cwd();
const SCAN_GLOBS = [
  new Bun.Glob("packages/*/src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"),
  new Bun.Glob("tools/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"),
];
const NODE_IMPORT = /from\s+["']node:|require\(\s*["']node:/;
const TTSC_IMPORT = /from\s+["'](?:ttsc|@ttsc\/)|require\(\s*["'](?:ttsc|@ttsc\/)/;

function isRuntimeSource(path: string): boolean {
  return !path.includes(".test.") && !path.includes("/testkit/") && !path.includes("\\testkit\\");
}

const offenders: string[] = [];
const toolchainImports: string[] = [];

for (const glob of SCAN_GLOBS) {
  for await (const path of glob.scan({ cwd: ROOT, absolute: true })) {
    if (!isRuntimeSource(path)) continue;
    const body = await Bun.file(path).text();
    const rel = relative(ROOT, path);
    if (NODE_IMPORT.test(body)) offenders.push(rel);
    if (rel.startsWith("packages/") && TTSC_IMPORT.test(body)) toolchainImports.push(rel);
  }
}

if (offenders.length > 0 || toolchainImports.length > 0) {
  if (offenders.length > 0) {
    console.error("[RUNTIME_NODE_IMPORT] Runtime source must prefer Bun APIs over `node:` imports.");
    for (const path of offenders) console.error(`- ${path}`);
  }
  if (toolchainImports.length > 0) {
    console.error("[RUNTIME_TTSC_IMPORT] Published package source must not import ttsc, Evidence, Graph, or lint.");
    for (const path of toolchainImports) console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log("runtime import check passed (packages + tools)");
