import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { describePluginTrustFlags, parsePluginList, suggestedTrustPath, writePluginTrust } from "../lib/setup";
import { usageError } from "../errors";

function renderMarkdown(output: Record<string, any>): string {
  return [
    "# Setup Plugin Trust",
    "",
    `- Trust file: ${output.outPath}`,
    `- Plugins: ${output.pluginCount}`,
    `- Plugin root suggestion: ${output.pluginRootSuggestion}`,
    "",
    "## Recommended flags",
    "",
    ...output.recommendedFlags.map((flag: string) => `- ${flag}`),
  ].join("\n");
}

export default defineCommand({
  name: "plugin-trust",
  description: "Generate a plugin trust file with sha256 digests",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    out: option(z.string().default(""), { description: "Trust file output path" }),
    relative: option(z.coerce.boolean().default(true), { description: "Store plugin keys relative to the trust file directory" }),
    force: option(z.coerce.boolean().default(false), { description: "Overwrite trust file if it exists" }),
    format: option(z.enum(["json", "md"]).default("md"), { description: "Output format" }),
  },
  async handler({ flags, cwd }) {
    if (!flags.plugin.trim()) {
      throw usageError("setup plugin-trust requires --plugin <path[,path]>");
    }
    const plugins = parsePluginList(flags.plugin);
    const outPath = flags.out.trim() ? flags.out : suggestedTrustPath(cwd);
    const result = await writePluginTrust({
      plugins,
      outPath,
      relative: flags.relative,
      force: flags.force,
    });

    const output = {
      ok: true,
      outPath: result.outPath,
      pluginCount: result.pluginCount,
      pluginEntries: result.pluginEntries,
      pluginRootSuggestion: result.pluginRootSuggestion,
      recommendedFlags: describePluginTrustFlags(result),
    };

    await writeOutput({
      format: flags.format,
      data: flags.format === "md" ? renderMarkdown(output) : output,
      meta: buildOutputMeta({ command: "setup.plugin-trust" }),
    });
  },
});
