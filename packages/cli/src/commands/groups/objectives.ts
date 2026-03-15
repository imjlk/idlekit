import { defineGroup } from "@bunli/core";
import objectivesListCommand from "../objectives";

export default defineGroup({
  name: "objectives",
  description: "Objective registry commands",
  commands: [objectivesListCommand],
});
