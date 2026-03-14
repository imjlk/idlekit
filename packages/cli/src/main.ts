#!/usr/bin/env bun
import { createCLI, defineGroup } from "@bunli/core";
import calibrateCommand from "./commands/calibrate";
import compareCommand from "./commands/compare";
import etaCommand from "./commands/eta";
import experienceCommand from "./commands/experience";
import growthCommand from "./commands/growth";
import initScenarioCommand from "./commands/initScenario";
import kpiRegressCommand from "./commands/kpiRegress";
import ltvCommand from "./commands/ltv";
import modelsListCommand from "./commands/modelsList";
import objectivesListCommand from "./commands/objectives";
import prestigeCycleCommand from "./commands/prestigeCycle";
import reportCommand from "./commands/report";
import replayVerifyCommand from "./commands/replayVerify";
import simulateCommand from "./commands/simulate";
import strategiesListCommand from "./commands/strategies";
import tuneCommand from "./commands/tune";
import validateCommand from "./commands/validate";
import { formatCliError, toCliError } from "./errors";

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

const initGroup = defineGroup({
  name: "init",
  description: "Scaffold templates",
  commands: [initScenarioCommand],
});

const replayGroup = defineGroup({
  name: "replay",
  description: "Replay artifact commands",
  commands: [replayVerifyCommand],
});

const kpiGroup = defineGroup({
  name: "kpi",
  description: "KPI guardrail commands",
  commands: [kpiRegressCommand],
});

const cli = await createCLI({
  name: "idk",
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

const GROUPS_WITH_SUBCOMMANDS = new Set(["models", "strategies", "objectives", "init", "replay", "kpi"]);

function resolveInvocation(argv: string[]): { commandName?: string; args: string[] } {
  const first = argv[0];
  if (!first || first.startsWith("-")) return { args: argv };

  if (GROUPS_WITH_SUBCOMMANDS.has(first)) {
    const second = argv[1];
    if (!second || second.startsWith("-")) return { args: argv };
    return {
      commandName: `${first} ${second}`,
      args: argv.slice(2),
    };
  }

  return {
    commandName: first,
    args: argv.slice(1),
  };
}

cli.command(validateCommand);
cli.command(modelsGroup);
cli.command(strategiesGroup);
cli.command(objectivesGroup);
cli.command(initGroup);
cli.command(replayGroup);
cli.command(kpiGroup);
cli.command(simulateCommand);
cli.command(experienceCommand);
cli.command(etaCommand);
cli.command(prestigeCycleCommand);
cli.command(growthCommand);
cli.command(ltvCommand);
cli.command(reportCommand);
cli.command(compareCommand);
cli.command(tuneCommand);
cli.command(calibrateCommand);

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const invocation = resolveInvocation(argv);
  try {
    if (!invocation.commandName) {
      await cli.run(argv);
    } else {
      await cli.execute(invocation.commandName, invocation.args);
    }
  } catch (error) {
    console.error(formatCliError(toCliError(error)));
    process.exitCode = 1;
  }
}

export { cli };
