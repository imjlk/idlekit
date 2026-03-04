import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export default defineCommand({
  name: "list",
  description: "List available models",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
  },
  async handler({ flags }) {
    const { modelRegistry } = await loadRegistries(parsePluginPaths(flags.plugin));
    const rows = modelRegistry.list();
    if (rows.length === 0) {
      console.log("No models registered");
      return;
    }

    for (const row of rows) {
      console.log(`${row.id}@${row.version}`);
    }
  },
});
