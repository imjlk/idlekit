import { defineCommand, option } from "@bunli/core";
import type { ModelRegistry } from "@idlekit/core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { ModelsListOutput } from "./list/types";
import { renderModelsList } from "../io/renderList";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

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
    format: option(z.enum(["json", "md", "csv"]).default("md"), { description: "Output format" }),
    out: option(z.string().optional(), { description: "Output file path" }),
  },
  async handler({ flags }) {
    const { modelRegistry } = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
      }),
    );
    const output = buildModelsList(modelRegistry);
    const body = renderModelsList(output, flags.format);

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
