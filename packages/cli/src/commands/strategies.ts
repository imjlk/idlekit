import { defineCommand, option } from "@bunli/core";
import type { StrategyRegistry } from "@idlekit/core";
import { z } from "zod";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export function cmdStrategiesList(args: {
  strategyRegistry: StrategyRegistry;
}): ReadonlyArray<{ id: string }> {
  return args.strategyRegistry.list();
}

export default defineCommand({
  name: "list",
  description: "List available strategies",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
  },
  async handler({ flags }) {
    const { strategyRegistry } = await loadRegistries(parsePluginPaths(flags.plugin));
    const rows = cmdStrategiesList({ strategyRegistry });

    if (rows.length === 0) {
      console.log("No strategies registered");
      return;
    }

    for (const row of rows) {
      console.log(row.id);
    }
  },
});
