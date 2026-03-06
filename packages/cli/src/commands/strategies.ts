import { defineCommand, option } from "@bunli/core";
import type { StrategyRegistry } from "@idlekit/core";
import { z } from "zod";
import type { StrategiesListOutput } from "./list/types";
import { writeListOutput } from "./_shared/listOutput";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { renderStrategiesList } from "../io/renderList";

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
    ...pluginOptions(),
    format: option(z.enum(["json", "md", "csv"]).default("md"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output file path" }),
  },
  async handler({ flags }) {
    const { strategyRegistry } = await loadRegistriesFromFlags(flags);
    const output = cmdStrategiesList({ strategyRegistry });
    await writeListOutput({
      format: flags.format,
      out: flags.out,
      command: "strategies.list",
      payload: output as Record<string, unknown>,
      render: renderStrategiesList as any,
    });
  },
});
