import { defineGroup } from "@bunli/core";
import setupCompletionsCommand from "../setupCompletions";
import setupPluginTrustCommand from "../setupPluginTrust";

export default defineGroup({
  name: "setup",
  description: "Semi-automated shell and plugin setup helpers",
  commands: [setupCompletionsCommand, setupPluginTrustCommand],
});
