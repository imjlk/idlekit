import { defineGroup } from "@bunli/core";
import strategiesListCommand from "../strategies";

export default defineGroup({
  name: "strategies",
  description: "Strategy registry commands",
  commands: [strategiesListCommand],
});
