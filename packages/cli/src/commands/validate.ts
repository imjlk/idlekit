import { defineCommand } from "@bunli/core";
import { validateScenarioV1 } from "@idlekit/core";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { scenarioInvalidError, usageError } from "../errors";
import { printNextSteps } from "../io/nextSteps";
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
      throw usageError("Usage: idk validate <scenario.(json|yaml)> [--plugin <path,...>]");
    }

    const { value: input, notices } = await readScenarioFileWithMeta(scenarioPath);
    const { modelRegistry } = await loadRegistriesFromFlags(flags);

    const r = validateScenarioV1(input, modelRegistry);
    if (!r.ok) {
      throw scenarioInvalidError(r.issues);
    }

    for (const n of notices) {
      const where = n.path ? `${n.path}: ` : "";
      console.warn(`[${n.level}] ${where}${n.message}`);
    }
    console.log(`OK: ${scenarioPath}`);
    printNextSteps({
      steps: [
        { label: "simulate", command: `idk simulate ${scenarioPath} --format json` },
        { label: "experience", command: `idk experience ${scenarioPath} --format md` },
      ],
    });
  },
});
