import { defineCommand, option } from "@bunli/core";
import type { ObjectiveRegistry } from "@idlekit/core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { ObjectivesListOutput } from "./list/types";
import { buildOutputMeta } from "../io/outputMeta";
import { renderObjectivesList } from "../io/renderList";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

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
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    "plugin-root": option(z.string().default(""), {
      description: "Comma-separated allowed plugin root directories",
    }),
    "plugin-sha256": option(z.string().default(""), {
      description: "Comma-separated '<path>=<sha256>' plugin integrity map",
    }),
    "plugin-trust-file": option(z.string().default(""), {
      description: "Plugin trust policy json file path",
    }),
    format: option(z.enum(["json", "md", "csv"]).default("md"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output file path" }),
  },
  async handler({ flags }) {
    const { objectiveRegistry } = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
        trustFile: flags["plugin-trust-file"],
      }),
    );
    const output = cmdObjectivesList({ objectiveRegistry });
    const outputForRender = (
      flags.format === "json"
        ? {
            ...output,
            _meta: buildOutputMeta({ command: "objectives.list" }),
          }
        : output
    ) as any;
    const body = renderObjectivesList(outputForRender, flags.format);

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
