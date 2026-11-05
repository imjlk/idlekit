import { defineGroup } from "../../runtime/command";
import exportEngineCommand from "../exportEngine";

export default defineGroup({
  name: "export",
  description: "Export scenario data for other tools",
  commands: [exportEngineCommand],
});
