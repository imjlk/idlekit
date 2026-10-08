import { defineGroup } from "../../runtime/command";
import kpiRegressCommand from "../kpiRegress";

export default defineGroup({
  name: "kpi",
  description: "KPI guardrail commands",
  commands: [kpiRegressCommand],
});
