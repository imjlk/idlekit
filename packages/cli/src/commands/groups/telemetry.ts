import { defineGroup } from "../../runtime/command";
import {
  telemetryCompareCommand, telemetryDriftCommand, telemetryExperimentCommand, telemetryPatchCommand, telemetryValidateCommand,
} from "../telemetry";

export default defineGroup({
  name: "telemetry",
  description: "Cohort batch validation, multi-cohort comparison, drift checks, retention patch workflow and experiment planning",
  commands: [telemetryValidateCommand, telemetryCompareCommand, telemetryDriftCommand, telemetryPatchCommand, telemetryExperimentCommand],
});
