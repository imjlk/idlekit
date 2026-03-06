import { defineCommand, option } from "@bunli/core";
import type { ModelRegistry } from "@idlekit/core";
import { z } from "zod";
import type { ModelsListOutput } from "./list/types";
import { writeListOutput } from "./_shared/listOutput";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { renderModelsList } from "../io/renderList";

export function buildModelsList(reg: ModelRegistry): ModelsListOutput {
  const rows = reg
    .list()
    .slice()
    .sort((a, b) => (a.id === b.id ? a.version - b.version : a.id < b.id ? -1 : 1))
    .map((x) => ({ id: x.id, version: x.version }));
  return { ok: true, models: rows };
}

export default defineCommand({
  name: "list",
  description: "List available models",
  options: {
    ...pluginOptions(),
    format: option(z.enum(["json", "md", "csv"]).default("md"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output file path" }),
  },
  async handler({ flags }) {
    const { modelRegistry } = await loadRegistriesFromFlags(flags);
    const output = buildModelsList(modelRegistry);
    await writeListOutput({
      format: flags.format,
      out: flags.out,
      command: "models.list",
      payload: output as Record<string, unknown>,
      render: renderModelsList as any,
    });
  },
});
