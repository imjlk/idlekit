import { defineCommand, option } from "@bunli/core";
import { validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export default defineCommand({
  name: "validate",
  description: "Validate scenario file",
  options: {
    plugin: option(z.string().default(""), {
      description: "Comma-separated plugin module paths",
    }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: econ validate <scenario.(json|yaml)> [--plugin <path,...>]");
    }

    const input = await readScenarioFile(scenarioPath);
    const { modelRegistry } = await loadRegistries(parsePluginPaths(flags.plugin));

    const r = validateScenarioV1(input, modelRegistry);
    if (!r.ok) {
      for (const issue of r.issues) {
        const where = issue.path ? `${issue.path}: ` : "";
        console.error(`- ${where}${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`OK: ${scenarioPath}`);
  },
});
