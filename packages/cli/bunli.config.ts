import { defineConfig } from "bunli";

export default defineConfig({
  name: "econ",
  version: "0.1.0",
  description: "Generic economy simulation CLI",
  commands: {
    entry: "./src/main.ts",
    directory: "./src/commands",
    generateReport: false,
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
