import { defineGroup } from "../../runtime/command";
import reviewCompareCommand from "../reviewCompare";
import reviewDoctorCommand from "../reviewDoctor";
import reviewEvaluateCommand from "../reviewEvaluate";

export default defineGroup({
  name: "review",
  description: "Readable Markdown review reports",
  commands: [reviewEvaluateCommand, reviewCompareCommand, reviewDoctorCommand],
});
