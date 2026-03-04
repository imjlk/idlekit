#!/usr/bin/env bun
import { createCLI, defineGroup } from "@bunli/core";
import compareCommand from "./commands/compare";
import etaCommand from "./commands/eta";
import growthCommand from "./commands/growth";
import modelsListCommand from "./commands/modelsList";
import objectivesListCommand from "./commands/objectives";
import prestigeCycleCommand from "./commands/prestigeCycle";
import reportCommand from "./commands/report";
import simulateCommand from "./commands/simulate";
import strategiesListCommand from "./commands/strategies";
import tuneCommand from "./commands/tune";
import validateCommand from "./commands/validate";

const modelsGroup = defineGroup({
  name: "models",
  description: "Model registry commands",
  commands: [modelsListCommand],
});

const strategiesGroup = defineGroup({
  name: "strategies",
  description: "Strategy registry commands",
  commands: [strategiesListCommand],
});

const objectivesGroup = defineGroup({
  name: "objectives",
  description: "Objective registry commands",
  commands: [objectivesListCommand],
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
cli.command(strategiesGroup);
cli.command(objectivesGroup);
cli.command(simulateCommand);
cli.command(etaCommand);
cli.command(prestigeCycleCommand);
cli.command(growthCommand);
cli.command(reportCommand);
cli.command(compareCommand);
cli.command(tuneCommand);

if (import.meta.main) {
  await cli.run(process.argv.slice(2));
}

export { cli };
