import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { CLI_NAME, CLI_VERSION } from "../cliMeta";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { fileExists } from "../runtime/bun";
import { runSelfCli } from "../runtime/selfCli";

function parseMinimumVersion(range: string): string {
  const match = range.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? "0.0.0";
}

function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function renderDoctorMarkdown(output: Record<string, any>): string {
  const lines = [
    "# Doctor Report",
    "",
    `- CLI: ${output.cli.name}@${output.cli.version}`,
    `- Bun: ${output.runtime.currentBun}`,
    `- Minimum Bun: ${output.runtime.requiredBun}`,
    `- Overall: ${output.ok ? "pass" : "fail"}`,
    "",
    "## Checks",
    "",
  ];

  for (const check of output.checks) {
    lines.push(`- ${check.id}: ${check.ok ? "pass" : "fail"}${check.detail ? ` (${check.detail})` : ""}`);
  }

  return lines.join("\n");
}

export default defineCommand({
  name: "doctor",
  description: "Check runtime, generated metadata, and completions wiring",
  options: {
    format: option(z.enum(["json", "md"]).default("md"), {
      description: "Output format",
    }),
    shell: option(z.enum(["zsh", "bash", "fish", "powershell"]).default("zsh"), {
      description: "Completion shell to validate",
    }),
  },
  async handler({ flags }) {
    const packageJson = await import("../../package.json", { with: { type: "json" } });
    const generatedUrl = new URL("../../.bunli/commands.gen.ts", import.meta.url);
    const generatedExists = await fileExists(generatedUrl.pathname);

    const requiredBun = parseMinimumVersion((packageJson.default?.engines as { bun?: string } | undefined)?.bun ?? ">=1.3.0");
    const bunOk = compareVersion(Bun.version, requiredBun) >= 0;

    let generatedCommands: string[] = [];
    let generatedError: string | undefined;
    if (generatedExists) {
      try {
        const generated = await import(generatedUrl.href);
        generatedCommands =
          typeof generated.listCommands === "function" ? (generated.listCommands() as string[]) : [];
      } catch (error) {
        generatedError = error instanceof Error ? error.message : String(error);
      }
    }

    const completions = runSelfCli(["completions", flags.shell]);
    const completionScriptOk = completions.exitCode === 0 && completions.stdout.trim().length > 0;
    const dynamicComplete = runSelfCli(["complete", "--", "compare", "--metric", ""]);
    const dynamicCompleteOk = dynamicComplete.exitCode === 0;

    const checks = [
      {
        id: "runtime.bun",
        ok: bunOk,
        detail: bunOk ? undefined : `requires Bun >= ${requiredBun}`,
      },
      {
        id: "generated.exists",
        ok: generatedExists,
        detail: generatedExists ? undefined : "missing .bunli/commands.gen.ts",
      },
      {
        id: "generated.inventory",
        ok: generatedCommands.includes("validate") && generatedCommands.includes("simulate") && generatedCommands.includes("experience"),
        detail:
          generatedError ??
          (generatedCommands.length > 0 ? `commands=${generatedCommands.join(",")}` : "unable to load generated commands"),
      },
      {
        id: "generated.groups",
        ok:
          generatedCommands.includes("models") &&
          generatedCommands.includes("strategies") &&
          generatedCommands.includes("objectives") &&
          generatedCommands.includes("init") &&
          generatedCommands.includes("replay") &&
          generatedCommands.includes("kpi"),
        detail: generatedCommands.length > 0 ? `commands=${generatedCommands.join(",")}` : generatedError,
      },
      {
        id: "completions.script",
        ok: completionScriptOk,
        detail: completionScriptOk ? `${flags.shell} script ready` : completions.stderr.trim() || "no completion output",
      },
      {
        id: "completions.dynamic",
        ok: dynamicCompleteOk,
        detail: dynamicCompleteOk ? "complete protocol available" : dynamicComplete.stderr.trim() || "dynamic completion failed",
      },
      {
        id: "metadata.version",
        ok: CLI_VERSION === packageJson.default.version && CLI_NAME === "idk",
        detail: `${CLI_NAME}@${CLI_VERSION}`,
      },
    ];

    const output = {
      ok: checks.every((check) => check.ok),
      cli: {
        name: CLI_NAME,
        version: CLI_VERSION,
      },
      runtime: {
        currentBun: Bun.version,
        requiredBun,
      },
      checks,
    };

    await writeOutput({
      format: flags.format,
      data: flags.format === "md" ? renderDoctorMarkdown(output) : output,
      meta: buildOutputMeta({
        command: "doctor",
      }),
    });
  },
});
