import { defineCommand } from "@bunli/core";
import { validateScenarioV1 } from "@idlekit/core";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { readScenarioFileWithMeta } from "../io/readScenario";

export default defineCommand({
  name: "validate",
  description: "Validate scenario file",
  options: {
    ...pluginOptions(),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk validate <scenario.(json|yaml)> [--plugin <path,...>]");
    }

    const { value: input, notices } = await readScenarioFileWithMeta(scenarioPath);
    const { modelRegistry } = await loadRegistriesFromFlags(flags);

    const r = validateScenarioV1(input, modelRegistry);
    if (!r.ok) {
      for (const issue of r.issues) {
        const where = issue.path ? `${issue.path}: ` : "";
        console.error(`- ${where}${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    for (const n of notices) {
      const where = n.path ? `${n.path}: ` : "";
      console.warn(`[${n.level}] ${where}${n.message}`);
    }
    console.log(`OK: ${scenarioPath}`);
  },
});
