import { defineGroup } from "@bunli/core";
import reviewCompareCommand from "../reviewCompare";
import reviewEvaluateCommand from "../reviewEvaluate";

export default defineGroup({
  name: "review",
  description: "Interactive human-review dashboards",
  commands: [reviewEvaluateCommand, reviewCompareCommand],
});
