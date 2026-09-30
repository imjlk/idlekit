import { loadConfig } from "@bunli/core";
import ttsc from "@ttsc/unplugin/bun";
import { basename, extname, join, resolve } from "path";

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

const config = await loadConfig(cliRoot);
const entryFromConfig = config.build.entry;
const defaultEntry = Array.isArray(entryFromConfig) ? entryFromConfig[0] : entryFromConfig;
const entry = flagValue("--entry") ?? defaultEntry ?? "src/main.ts";
const outdir = flagValue("--outdir") ?? config.build.outdir ?? "./dist";
const targets = flagValue("--targets");
if (targets !== undefined && targets !== "native") {
  throw new Error(
    "cli-bundle.ts preserves the repository JS bundle and --targets native. Other bunli target lists are not guessed.",
  );
}

const minify = config.build.minify;
const sourcemap = process.argv.includes("--sourcemap") ? true : config.build.sourcemap;
// Inlining @opentui/core breaks its bundled asset loader (loadedPath is
// undefined). Keep the packages external. The CLI depends on both so
// dist/main.js can resolve them. Bun 1.3.10 then does not have to bundle
// @opentui/core's optional platform imports.
const external = [...new Set([...(config.build.external ?? []), "@opentui/react", "@opentui/core"])];
const outdirAbs = resolve(cliRoot, outdir);
const generateEntry = config.commands?.entry ?? entry;
const generateDirectory = config.commands?.directory ?? "src/commands";
const generated = Bun.spawnSync(
  [
    resolve(cliRoot, "node_modules/.bin/bunli"),
    "generate",
    "--entry",
    generateEntry,
    "--directory",
    generateDirectory,
    "--output",
    "./.bunli/commands.gen.ts",
  ],
  { cwd: cliRoot, stdout: "inherit", stderr: "inherit" },
);
if (generated.exitCode !== 0) {
  throw new Error("bunli generate failed");
}
const plugins = [ttsc()];

await Bun.$`rm -rf ${outdirAbs}`.quiet();
await Bun.$`mkdir -p ${outdirAbs}`.quiet();

if (targets === "native") {
  const stem = basename(entry, extname(entry));
  const outfile = join(outdir, process.platform === "win32" ? `${stem}.exe` : stem);
  const result = await Bun.build({
    entrypoints: [entry],
    minify,
    sourcemap,
    external,
    plugins,
    compile: {
      outfile,
    },
  });
  if (!result.success) {
    throw new Error(result.logs.join("\n"));
  }
  console.log(`compiled ${outfile}`);
} else {
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
    await Bun.$`chmod +x ${output.path}`.quiet();
  }
  console.log(`bundled ${outdir}`);
}
