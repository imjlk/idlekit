import { defineCommand, option } from "@bunli/core";
import type { StrategyRegistry } from "@idlekit/core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { StrategiesListOutput } from "./list/types";
import { renderStrategiesList } from "../io/renderList";
import { loadRegistries, parsePluginPaths } from "../plugin/load";

export function cmdStrategiesList(args: {
  strategyRegistry: StrategyRegistry;
}): StrategiesListOutput {
  const rows = args.strategyRegistry
    .list()
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => {
      const f = args.strategyRegistry.get(x.id)!;
      return {
        id: f.id,
        hasParamsSchema: !!f.paramsSchema,
        hasDefaultParams: f.defaultParams !== undefined,
      };
    });

  return { ok: true, strategies: rows };
}

export default defineCommand({
  name: "list",
  description: "List available strategies",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    format: option(z.enum(["json", "md", "csv"]).default("md"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output file path" }),
  },
  async handler({ flags }) {
    const { strategyRegistry } = await loadRegistries(parsePluginPaths(flags.plugin));
    const output = cmdStrategiesList({ strategyRegistry });
    const body = renderStrategiesList(output, flags.format);

    if (!flags.out) {
      process.stdout.write(body);
      return;
    }

    const path = resolve(flags.out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
    console.log(`Wrote ${flags.format} output to ${path}`);
  },
});
