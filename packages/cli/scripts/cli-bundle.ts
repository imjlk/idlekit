import ttsc from "@ttsc/unplugin/bun";
import { isAbsolute, relative, resolve } from "path";

const cliRoot = resolve(import.meta.dir, "..");
process.chdir(cliRoot);

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const entry = flagValue("--entry") ?? "src/main.ts";
const outdir = flagValue("--outdir") ?? "./dist";
const targets = flagValue("--targets");
if (targets !== undefined && targets !== "native") {
  throw new Error(
    "cli-bundle.ts supports the repository JS bundle and --targets native only.",
  );
}

const minify = false;
const sourcemap = process.argv.includes("--sourcemap") ? "external" : "none";
const external: string[] = [];
const outdirAbs = resolve(cliRoot, outdir);
const outputRelative = relative(cliRoot, outdirAbs);
if (!outputRelative || outputRelative === ".." || outputRelative.startsWith("../") || outputRelative.startsWith("..\\") || isAbsolute(outputRelative)) {
  throw new Error("Bundle output must be a directory inside packages/cli.");
}
const plugins = [ttsc()];


await Bun.$`rm -rf ${outdirAbs}`.quiet();
await Bun.$`mkdir -p ${outdirAbs}`.quiet();

{
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "bun",
    format: "esm",
    minify,
    sourcemap: targets === "native" ? "inline" : sourcemap,
    external,
    plugins,
    ...(targets === "native" ? { compile: { outfile: resolve(outdirAbs, process.platform === "win32" ? "idk.exe" : "idk") } } : {}),
  });
  if (!result.success) {
    throw new Error(result.logs.join("\n"));
  }
  for (const output of result.outputs) {
    if (!output.path.endsWith(".js")) continue;
    const body = await output.text();
    const withoutShebang = body.replace(/^#![^\n]*\n/, "");
    await Bun.write(output.path, `#!/usr/bin/env bun\n${withoutShebang}`);
    if (process.platform !== "win32") await Bun.$`chmod +x ${output.path}`.quiet();
  }
  console.log(`bundled ${outdir}`);
}
