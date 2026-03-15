import { defineConfig } from "bunli";
import { CLI_DESCRIPTION, CLI_NAME, CLI_VERSION } from "./src/cliMeta";
import { bunliPlugins } from "./src/bunliPlugins";

export default defineConfig({
  name: CLI_NAME,
  version: CLI_VERSION,
  description: CLI_DESCRIPTION,
  generated: true,
  plugins: bunliPlugins as any,
  commands: {
    entry: "./src/main.ts",
  },
  build: {
    entry: "./src/main.ts",
    outdir: "./dist",
    minify: false,
    sourcemap: true,
    targets: [],
    compress: false,
  },
  dev: {
    watch: true,
    inspect: false,
  },
});
