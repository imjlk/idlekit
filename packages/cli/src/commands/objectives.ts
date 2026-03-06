import { defineCommand, option } from "@bunli/core";
import type { ObjectiveRegistry } from "@idlekit/core";
import { z } from "zod";
import type { ObjectivesListOutput } from "./list/types";
import { writeListOutput } from "./_shared/listOutput";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { renderObjectivesList } from "../io/renderList";

export function cmdObjectivesList(args: {
  objectiveRegistry: ObjectiveRegistry;
}): ObjectivesListOutput {
  const rows = args.objectiveRegistry
    .list()
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => {
      const f = args.objectiveRegistry.get(x.id)!;
      return {
        id: f.id,
        hasParamsSchema: !!f.paramsSchema,
        hasDefaultParams: f.defaultParams !== undefined,
      };
    });

  return { ok: true, objectives: rows };
}

export default defineCommand({
  name: "list",
  description: "List optimization objectives",
  options: {
    ...pluginOptions(),
    format: option(z.enum(["json", "md", "csv"]).default("md"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output file path" }),
  },
  async handler({ flags }) {
    const { objectiveRegistry } = await loadRegistriesFromFlags(flags);
    const output = cmdObjectivesList({ objectiveRegistry });
    await writeListOutput({
      format: flags.format,
      out: flags.out,
      command: "objectives.list",
      payload: output as Record<string, unknown>,
      render: renderObjectivesList as any,
    });
  },
});
