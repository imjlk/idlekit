import { defineGroup } from "@bunli/core";
import initScenarioCommand from "../initScenario";

export default defineGroup({
  name: "init",
  description: "Scaffold templates",
  commands: [initScenarioCommand],
});
