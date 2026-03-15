import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { installCompletions, readCompletionSetup } from "../lib/setup";

function renderMarkdown(output: Record<string, any>): string {
  return [
    "# Setup Completions",
    "",
    `- Shell: ${output.shell}`,
    `- RC path: ${output.rcPath}`,
    `- Installed: ${output.installed ? "yes" : "no"}`,
    `- Line: ${output.line}`,
    output.printOnly ? "- Mode: print" : `- Updated: ${output.updated ? "yes" : "no"}`,
  ].join("\n");
}

export default defineCommand({
  name: "completions",
  description: "Install or inspect shell completions setup",
  options: {
    shell: option(z.enum(["detect", "zsh", "bash", "fish", "powershell"]).default("detect"), {
      description: "Target shell",
    }),
    rc: option(z.string().optional(), { description: "Explicit RC/profile path override" }),
    print: option(z.coerce.boolean().default(false), { description: "Print the completion setup line instead of writing it" }),
    force: option(z.coerce.boolean().default(false), { description: "Rewrite the managed completion block even if unchanged" }),
    format: option(z.enum(["json", "md"]).default("md"), { description: "Output format" }),
  },
  async handler({ flags }) {
    const inspection = await readCompletionSetup({
      shell: flags.shell,
      rcPath: flags.rc,
    });
    const install = await installCompletions({
      shell: flags.shell,
      rcPath: flags.rc,
      printOnly: flags.print,
      force: flags.force,
    });

    const output = {
      ok: true,
      shell: install.shell,
      rcPath: install.rcPath,
      line: install.line,
      installed: inspection.installed || install.updated,
      updated: install.updated,
      printOnly: flags.print,
    };

    await writeOutput({
      format: flags.format,
      data: flags.format === "md" ? renderMarkdown(output) : output,
      meta: buildOutputMeta({ command: "setup.completions" }),
    });
  },
});
