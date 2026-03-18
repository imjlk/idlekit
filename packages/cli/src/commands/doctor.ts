import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { CLI_NAME, CLI_VERSION } from "../cliMeta";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import {
  describePluginTrustFlags,
  installCompletions,
  parsePluginList,
  readCompletionSetup,
  suggestedTrustPath,
  writePluginTrust,
} from "../lib/setup";
import { fileExists } from "../runtime/bun";
import { runSelfCli } from "../runtime/selfCli";
import { usageError } from "../errors";

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

  if (Array.isArray(output.fixes) && output.fixes.length > 0) {
    lines.push("", "## Fixes", "");
    for (const fix of output.fixes) {
      lines.push(`- ${fix.id}: ${fix.status}${fix.detail ? ` (${fix.detail})` : ""}`);
    }
  }

  return lines.join("\n");
}

type DoctorFix = Readonly<{
  id: "completions" | "plugin-trust";
  status: "applied" | "skipped";
  detail?: string;
}>;

function buildChecks(args: {
  bunOk: boolean;
  requiredBun: string;
  generatedExists: boolean;
  generatedCommands: string[];
  generatedError?: string;
  completionScriptOk: boolean;
  completionScriptDetail: string;
  dynamicCompleteOk: boolean;
  dynamicCompleteDetail: string;
  completionInstalled: boolean;
  completionRcPath: string;
  metadataVersionOk: boolean;
}) {
  return [
    {
      id: "runtime.bun",
      ok: args.bunOk,
      detail: args.bunOk ? undefined : `requires Bun >= ${args.requiredBun}`,
    },
    {
      id: "generated.exists",
      ok: args.generatedExists,
      detail: args.generatedExists ? undefined : "missing .bunli/commands.gen.ts",
    },
    {
      id: "generated.inventory",
      ok: args.generatedCommands.includes("validate") && args.generatedCommands.includes("simulate") && args.generatedCommands.includes("experience"),
      detail:
        args.generatedError ??
        (args.generatedCommands.length > 0 ? `commands=${args.generatedCommands.join(",")}` : "unable to load generated commands"),
    },
    {
      id: "generated.groups",
      ok:
        args.generatedCommands.includes("models") &&
        args.generatedCommands.includes("strategies") &&
        args.generatedCommands.includes("objectives") &&
        args.generatedCommands.includes("init") &&
        args.generatedCommands.includes("replay") &&
        args.generatedCommands.includes("kpi"),
      detail: args.generatedCommands.length > 0 ? `commands=${args.generatedCommands.join(",")}` : args.generatedError,
    },
    {
      id: "completions.script",
      ok: args.completionScriptOk,
      detail: args.completionScriptDetail,
    },
    {
      id: "completions.dynamic",
      ok: args.dynamicCompleteOk,
      detail: args.dynamicCompleteDetail,
    },
    {
      id: "completions.installed",
      ok: args.completionInstalled,
      detail: args.completionInstalled
        ? `managed block present in ${args.completionRcPath}`
        : `managed block missing in ${args.completionRcPath}`,
    },
    {
      id: "metadata.version",
      ok: args.metadataVersionOk,
      detail: `${CLI_NAME}@${CLI_VERSION}`,
    },
  ];
}

export default defineCommand({
  name: "doctor",
  description: "Check runtime, generated metadata, and completions wiring",
  options: {
    format: option(z.enum(["json", "md"]).default("md"), {
      description: "Output format",
    }),
    shell: option(z.enum(["detect", "zsh", "bash", "fish", "powershell"]).default("detect"), {
      description: "Completion shell to validate",
    }),
    rc: option(z.string().optional(), {
      description: "Optional shell rc/profile path for completion installation checks",
    }),
    fix: option(z.coerce.boolean().default(false), {
      description: "Apply completion/plugin-trust fixes after the checks run",
    }),
    wizard: option(z.coerce.boolean().default(false), {
      description: "Interactive doctor fix flow for completions and plugin trust",
    }),
    yes: option(z.coerce.boolean().default(false), {
      description: "Skip confirmations when applying doctor fixes",
    }),
    plugin: option(z.string().default(""), {
      description: "Optional plugin path(s) for trust file generation during doctor fix",
    }),
    "trust-out": option(z.string().default(""), {
      description: "Optional plugin trust file output path used by doctor fix",
    }),
    force: option(z.coerce.boolean().default(false), {
      description: "Overwrite existing completion/trust files when fixing",
    }),
  },
  async handler({ flags, prompt, terminal, cwd }) {
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

    const completionShell = flags.shell;
    const completions = runSelfCli(["completions", completionShell === "detect" ? "zsh" : completionShell]);
    const completionScriptOk = completions.exitCode === 0 && completions.stdout.trim().length > 0;
    const dynamicComplete = runSelfCli(["complete", "--", "compare", "--metric", ""]);
    const dynamicCompleteOk = dynamicComplete.exitCode === 0;
    const completionSetup = await readCompletionSetup({
      shell: flags.shell,
      rcPath: flags.rc,
    });

    const metadataVersionOk = CLI_VERSION === packageJson.default.version && CLI_NAME === "idk";

    const fixes: DoctorFix[] = [];
    const wantsWizard = flags.wizard;
    const wantsFix = flags.fix || wantsWizard;

    if (wantsWizard && (!terminal.isInteractive || terminal.isCI)) {
      throw usageError("doctor --wizard requires an interactive terminal.", "Use --fix true with explicit flags in non-interactive environments.");
    }

    if (wantsFix) {
      let shouldInstallCompletions = true;
      let shouldWriteTrust = flags.plugin.trim().length > 0;
      let pluginValue = flags.plugin;
      let trustOutValue = flags["trust-out"];

      if (wantsWizard) {
        prompt.intro("Doctor fix wizard");
        shouldInstallCompletions = await prompt.confirm("Install or refresh the managed completion block?", {
          default: !completionSetup.installed,
        });
        shouldWriteTrust = await prompt.confirm("Generate a plugin trust file?", {
          default: flags.plugin.trim().length > 0,
        });
        if (shouldWriteTrust && !pluginValue.trim()) {
          pluginValue = await prompt.text("Plugin path(s)", {
            placeholder: "../../examples/plugins/custom-econ-plugin.ts",
          });
        }
        if (shouldWriteTrust && !trustOutValue.trim()) {
          trustOutValue = await prompt.text("Trust file output path", {
            default: suggestedTrustPath(cwd),
          });
        }
      }

      if (shouldInstallCompletions) {
        if (wantsWizard && !flags.yes) {
          const confirmed = await prompt.confirm(`Write completions block to ${completionSetup.rcPath}?`, {
            default: true,
          });
          if (!confirmed) {
            fixes.push({ id: "completions", status: "skipped", detail: "user declined completion install" });
          } else {
            const result = await installCompletions({
              shell: flags.shell,
              rcPath: flags.rc,
              force: flags.force,
            });
            fixes.push({
              id: "completions",
              status: "applied",
              detail: result.updated ? `updated ${result.rcPath}` : `already configured in ${result.rcPath}`,
            });
          }
        } else {
          const result = await installCompletions({
            shell: flags.shell,
            rcPath: flags.rc,
            force: flags.force,
          });
          fixes.push({
            id: "completions",
            status: "applied",
            detail: result.updated ? `updated ${result.rcPath}` : `already configured in ${result.rcPath}`,
          });
        }
      }

      if (shouldWriteTrust) {
        const plugins = parsePluginList(pluginValue);
        if (plugins.length === 0) {
          fixes.push({ id: "plugin-trust", status: "skipped", detail: "no plugin paths provided" });
        } else {
          const trustOut = trustOutValue.trim() ? trustOutValue : suggestedTrustPath(cwd);
          const trustResult = await writePluginTrust({
            plugins,
            outPath: trustOut,
            force: flags.force,
            relative: true,
          });
          fixes.push({
            id: "plugin-trust",
            status: "applied",
            detail: `${trustResult.outPath} (${describePluginTrustFlags(trustResult).join(" ")})`,
          });
        }
      }

      if (wantsWizard) {
        prompt.outro("Doctor fix wizard complete.");
      }
    }

    const completionSetupFinal = wantsFix
      ? await readCompletionSetup({
          shell: flags.shell,
          rcPath: flags.rc,
        })
      : completionSetup;

    const checks = buildChecks({
      bunOk,
      requiredBun,
      generatedExists,
      generatedCommands,
      generatedError,
      completionScriptOk,
      completionScriptDetail: completionScriptOk ? `${completionSetupFinal.shell} script ready` : completions.stderr.trim() || "no completion output",
      dynamicCompleteOk,
      dynamicCompleteDetail: dynamicCompleteOk ? "complete protocol available" : dynamicComplete.stderr.trim() || "dynamic completion failed",
      completionInstalled: completionSetupFinal.installed,
      completionRcPath: completionSetupFinal.rcPath,
      metadataVersionOk,
    });

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
      fixes,
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
