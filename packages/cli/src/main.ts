#!/usr/bin/env bun
import { createCLI, defineGroup } from "@bunli/core";
import compareCommand from "./commands/compare";
import etaCommand from "./commands/eta";
import growthCommand from "./commands/growth";
import modelsListCommand from "./commands/modelsList";
import prestigeCycleCommand from "./commands/prestigeCycle";
import reportCommand from "./commands/report";
import simulateCommand from "./commands/simulate";
import validateCommand from "./commands/validate";

const modelsGroup = defineGroup({
  name: "models",
  description: "Model registry commands",
  commands: [modelsListCommand],
});

const cli = await createCLI({
  name: "econ",
  version: "0.1.0",
  description: "Generic economy simulation CLI",
  commands: {
    entry: "./src/main.ts",
    directory: "./src/commands",
  },
  build: {
    entry: "./src/main.ts",
    outdir: "./dist",
    minify: false,
    sourcemap: true,
    targets: [],
    compress: false,
  },
});

cli.command(validateCommand);
cli.command(modelsGroup);
cli.command(simulateCommand);
cli.command(etaCommand);
cli.command(prestigeCycleCommand);
cli.command(growthCommand);
cli.command(reportCommand);
cli.command(compareCommand);

if (import.meta.main) {
  await cli.run(process.argv.slice(2));
}

export { cli };
