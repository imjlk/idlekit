#!/usr/bin/env bun
import { createCLI } from "@bunli/core";
import calibrateCommand from "./commands/calibrate";
import compareCommand from "./commands/compare";
import doctorCommand from "./commands/doctor";
import etaCommand from "./commands/eta";
import evaluateCommand from "./commands/evaluate";
import experienceCommand from "./commands/experience";
import growthCommand from "./commands/growth";
import initScenarioCommand from "./commands/initScenario";
import kpiRegressCommand from "./commands/kpiRegress";
import ltvCommand from "./commands/ltv";
import prestigeCycleCommand from "./commands/prestigeCycle";
import reportCommand from "./commands/report";
import simulateCommand from "./commands/simulate";
import tuneCommand from "./commands/tune";
import validateCommand from "./commands/validate";
import initGroup from "./commands/groups/init";
import kpiGroup from "./commands/groups/kpi";
import modelsGroup from "./commands/groups/models";
import objectivesGroup from "./commands/groups/objectives";
import replayGroup from "./commands/groups/replay";
import reviewGroup from "./commands/groups/review";
import setupGroup from "./commands/groups/setup";
import strategiesGroup from "./commands/groups/strategies";
import { CLI_DESCRIPTION, CLI_NAME, CLI_VERSION } from "./cliMeta";
import { bunliPlugins } from "./bunliPlugins";
import { formatCliError, toCliError } from "./errors";

const cli = await createCLI({
  name: CLI_NAME,
  version: CLI_VERSION,
  description: CLI_DESCRIPTION,
  generated: true,
  plugins: bunliPlugins as any,
  commands: {
    entry: "./src/main.ts",
  },
});

const GROUPS_WITH_SUBCOMMANDS = new Set(["models", "strategies", "objectives", "init", "replay", "kpi", "review", "setup"]);

function resolveInvocation(argv: string[]): { commandName?: string; args: string[] } {
  const first = argv[0];
  if (!first || first.startsWith("-")) return { args: argv };
  if (first === "help" || first === "--help" || first === "-h" || first === "--version" || first === "-v") {
    return { args: argv };
  }

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
cli.command(reviewGroup);
cli.command(setupGroup);
cli.command(doctorCommand);
cli.command(evaluateCommand);
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
  try {
    const argv = process.argv.slice(2);
    const invocation = resolveInvocation(argv);
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
