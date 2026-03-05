import { defineCommand, option } from "@bunli/core";
import { validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { readScenarioFileWithMeta } from "../io/readScenario";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

export default defineCommand({
  name: "validate",
  description: "Validate scenario file",
  options: {
    plugin: option(z.string().default(""), {
      description: "Comma-separated plugin module paths",
    }),
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    "plugin-root": option(z.string().default(""), {
      description: "Comma-separated allowed plugin root directories",
    }),
    "plugin-sha256": option(z.string().default(""), {
      description: "Comma-separated '<path>=<sha256>' plugin integrity map",
    }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk validate <scenario.(json|yaml)> [--plugin <path,...>]");
    }

    const { value: input, notices } = await readScenarioFileWithMeta(scenarioPath);
    const { modelRegistry } = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
      }),
    );

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
