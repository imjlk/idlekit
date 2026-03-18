import { basename, dirname, relative, resolve } from "path";
import { cliError, usageError } from "../errors";
import { fileExists, readTextFile, sha256Hex, writeTextFile } from "../runtime/bun";
import { runSelfCli } from "../runtime/selfCli";

export type SupportedShell = "zsh" | "bash" | "fish" | "powershell";

export type CompletionInstallResult = Readonly<{
  shell: SupportedShell;
  rcPath: string;
  line: string;
  updated: boolean;
  mode: "managed-block" | "print";
}>;

export type PluginTrustResult = Readonly<{
  outPath: string;
  plugins: readonly string[];
  pluginCount: number;
  pluginEntries: Readonly<Record<string, string>>;
  pluginRootSuggestion: string;
  updated: boolean;
}>;

const START_MARKER = "# >>> idk completions >>>";
const END_MARKER = "# <<< idk completions <<<";

function userHome(): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw cliError("CLI_USAGE", "Unable to determine the user home directory for setup automation.");
  }
  return home;
}

export function detectShell(input?: string): SupportedShell {
  const raw = (input && input !== "detect" ? input : process.env.SHELL || process.env.ComSpec || "").toLowerCase();
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("bash")) return "bash";
  if (raw.includes("fish")) return "fish";
  if (raw.includes("powershell") || raw.includes("pwsh")) return "powershell";
  return "zsh";
}

export function defaultRcPath(shell: SupportedShell): string {
  const home = userHome();
  switch (shell) {
    case "zsh":
      return resolve(home, ".zshrc");
    case "bash":
      return resolve(home, ".bashrc");
    case "fish":
      return resolve(home, ".config/fish/config.fish");
    case "powershell":
      return resolve(home, "Documents/PowerShell/Microsoft.PowerShell_profile.ps1");
  }
}

export function completionsSourceLine(shell: SupportedShell, executable = "idk"): string {
  switch (shell) {
    case "zsh":
    case "bash":
      return `source <(${executable} completions ${shell})`;
    case "fish":
      return `${executable} completions fish | source`;
    case "powershell":
      return `${executable} completions powershell | Out-String | Invoke-Expression`;
  }
}

function replaceManagedBlock(existing: string, block: string): { body: string; updated: boolean } {
  const normalized = existing.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(START_MARKER);
  const end = normalized.indexOf(END_MARKER);
  if (start >= 0 && end >= start) {
    const afterEnd = normalized.indexOf("\n", end);
    const nextIndex = afterEnd >= 0 ? afterEnd + 1 : normalized.length;
    const body = `${normalized.slice(0, start)}${block}${normalized.slice(nextIndex)}`;
    return { body, updated: body !== normalized };
  }
  const prefix = normalized.length > 0 && !normalized.endsWith("\n") ? `${normalized}\n` : normalized;
  return { body: `${prefix}${block}`, updated: true };
}

export async function installCompletions(args: {
  shell?: string;
  rcPath?: string;
  executable?: string;
  printOnly?: boolean;
  force?: boolean;
}): Promise<CompletionInstallResult> {
  const shell = detectShell(args.shell);
  const rcPath = resolve(args.rcPath ?? defaultRcPath(shell));
  const line = completionsSourceLine(shell, args.executable ?? "idk");

  const script = runSelfCli(["completions", shell]);
  if (script.exitCode !== 0) {
    throw cliError("INTERNAL_ERROR", `Unable to generate ${shell} completions.`, {
      detail: script.stderr.trim() || script.stdout.trim(),
    });
  }

  if (args.printOnly) {
    return {
      shell,
      rcPath,
      line,
      updated: false,
      mode: "print",
    };
  }

  const block = `${START_MARKER}\n${line}\n${END_MARKER}\n`;
  const exists = await fileExists(rcPath);
  const existing = exists ? await readTextFile(rcPath) : "";
  const next = replaceManagedBlock(existing, block);
  if (!next.updated && !args.force) {
    return {
      shell,
      rcPath,
      line,
      updated: false,
      mode: "managed-block",
    };
  }

  await writeTextFile(rcPath, next.body);
  return {
    shell,
    rcPath,
    line,
    updated: true,
    mode: "managed-block",
  };
}

export async function readCompletionSetup(args: {
  shell?: string;
  rcPath?: string;
  executable?: string;
}): Promise<Readonly<{
  shell: SupportedShell;
  rcPath: string;
  installed: boolean;
  line: string;
}>> {
  const shell = detectShell(args.shell);
  const rcPath = resolve(args.rcPath ?? defaultRcPath(shell));
  const line = completionsSourceLine(shell, args.executable ?? "idk");
  const exists = await fileExists(rcPath);
  if (!exists) {
    return { shell, rcPath, installed: false, line };
  }
  const contents = await readTextFile(rcPath);
  const installed = contents.includes(START_MARKER) && contents.includes(END_MARKER) && contents.includes(line);
  return { shell, rcPath, installed, line };
}

function commonDir(paths: readonly string[]): string {
  const parts = paths.map((value) => dirname(resolve(value)).split("/").filter(Boolean));
  if (parts.length === 0) return process.cwd();
  const first = parts[0] ?? [];
  const shared: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (!segment) break;
    if (parts.every((current) => current[index] === segment)) {
      shared.push(segment);
    } else {
      break;
    }
  }
  return `/${shared.join("/")}` || "/";
}

export async function writePluginTrust(args: {
  plugins: readonly string[];
  outPath: string;
  relative?: boolean;
  force?: boolean;
}): Promise<PluginTrustResult> {
  if (args.plugins.length === 0) {
    throw usageError("setup plugin-trust requires at least one --plugin path.");
  }
  const outPath = resolve(args.outPath);
  if ((await fileExists(outPath)) && !args.force) {
    throw usageError(`Output file already exists: ${outPath}`, "Pass --force true to overwrite.");
  }

  const entries: Record<string, string> = {};
  for (const plugin of args.plugins) {
    const path = resolve(plugin);
    const digest = sha256Hex(await readTextFile(path));
    const key = args.relative === false ? path : relative(dirname(outPath), path);
    entries[key] = digest;
  }

  const payload = {
    plugins: entries,
  };
  await writeTextFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  return {
    outPath,
    plugins: args.plugins.map((plugin) => resolve(plugin)),
    pluginCount: args.plugins.length,
    pluginEntries: entries,
    pluginRootSuggestion: commonDir(args.plugins.map((plugin) => resolve(plugin))),
    updated: true,
  };
}

export function parsePluginList(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => resolve(value));
}

export function suggestedTrustPath(baseDir = process.cwd()): string {
  return resolve(baseDir, ".idk/plugin-trust.json");
}

export function describePluginTrustFlags(result: PluginTrustResult): string[] {
  return [
    "--allow-plugin true",
    `--plugin ${result.plugins.join(",")}`,
    `--plugin-root ${result.pluginRootSuggestion}`,
    `--plugin-trust-file ${result.outPath}`,
  ];
}

export function inferredTuneWizardPath(scenarioPath: string): string {
  const file = basename(scenarioPath).replace(/\.json$/i, "");
  return resolve(process.cwd(), `${file}-tune.json`);
}
