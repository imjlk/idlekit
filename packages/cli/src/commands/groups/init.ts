import { defineGroup } from "../../runtime/command";
import initScenarioCommand from "../initScenario";

export default defineGroup({
  name: "init",
  description: "Scaffold templates",
  commands: [initScenarioCommand],
});
