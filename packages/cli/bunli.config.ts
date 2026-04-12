import { defineConfig } from "@bunli/core";
import packageJson from "./package.json" with { type: "json" };
import { bunliPlugins } from "./src/bunliPlugins";

export default defineConfig({
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  plugins: bunliPlugins as any,
  commands: {
    entry: "./src/main.ts",
    directory: "./src/commands",
    generateReport: true,
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
  tui: {
    renderer: {
      bufferMode: "alternate",
    },
  },
});
