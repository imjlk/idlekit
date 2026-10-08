import ttsc from "@ttsc/unplugin/bun";
import { resolve } from "path";

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
// Inlining @opentui/core breaks its bundled asset loader (loadedPath is
// undefined). Keep the packages external. The CLI depends on both so
// dist/main.js can resolve them. Bun 1.3.10 then does not have to bundle
// @opentui/core's optional platform imports.
const external = ["react", "@opentui/react", "@opentui/core"];
const outdirAbs = resolve(cliRoot, outdir);
const plugins = [ttsc()];

if (targets === "native") {
  throw new Error(
    "build:bin does not emit a standalone executable. @opentui/core loads optional platform packages and its asset loader cannot be inlined. The JS bundle keeps react, @opentui/react, and @opentui/core external.",
  );
}

await Bun.$`rm -rf ${outdirAbs}`.quiet();
await Bun.$`mkdir -p ${outdirAbs}`.quiet();

{
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "bun",
    format: "esm",
    minify,
    sourcemap,
    external,
    plugins,
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
