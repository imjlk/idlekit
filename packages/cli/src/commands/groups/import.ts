import { defineGroup } from "../../runtime/command";
import importScenarioCommand from "../importScenario";

export default defineGroup({
  name: "import",
  description: "Import game data as idlekit scenarios",
  commands: [importScenarioCommand],
});
