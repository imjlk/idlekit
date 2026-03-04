import { defineCommand, option } from "@bunli/core";
import type { ObjectiveRegistry } from "@idlekit/core";
import { z } from "zod";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export function cmdObjectivesList(args: {
  objectiveRegistry: ObjectiveRegistry;
}): ReadonlyArray<{ id: string }> {
  return args.objectiveRegistry.list();
}

export default defineCommand({
  name: "list",
  description: "List optimization objectives",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
  },
  async handler({ flags }) {
    const { objectiveRegistry } = await loadRegistries(parsePluginPaths(flags.plugin));
    const rows = cmdObjectivesList({ objectiveRegistry });

    if (rows.length === 0) {
      console.log("No objectives registered");
      return;
    }

    for (const row of rows) {
      console.log(row.id);
    }
  },
});
