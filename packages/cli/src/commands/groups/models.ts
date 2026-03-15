import { defineGroup } from "@bunli/core";
import modelsListCommand from "../modelsList";

export default defineGroup({
  name: "models",
  description: "Model registry commands",
  commands: [modelsListCommand],
});
