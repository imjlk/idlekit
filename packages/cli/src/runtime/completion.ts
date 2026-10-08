import { usageError } from "../errors";
import { commandOptions, defineCommand, optionShape, type CommandDefinition } from "./command";
import { writeStdout } from "./bun";

/** Completion reads the same schemas as Gunshi dispatch; no generated source is loaded. */
export function completionCandidates(commands: readonly CommandDefinition[], words: readonly string[]): string[] {
  let scope = commands;
  let command: CommandDefinition | undefined;
  let index = 0;
  while (index < words.length - 1) {
    const next = scope.find(item => item.name === words[index]);
    if (!next) break;
    command = next;
    index++;
    if (!command.commands) break;
    scope = command.commands;
  }
  const prefix = words.at(-1) ?? "";
  if (!command || command.commands) return scope.map(item => item.name).filter(name => name.startsWith(prefix)).sort();
  const options = commandOptions(command);
  const previous = words.at(-2);
  if (previous?.startsWith("--") && options[previous.slice(2)]) {
    const shape = optionShape(options[previous.slice(2)]!);
    const values = shape.enum ?? (shape.type === "boolean" ? ["true", "false"] : []);
    return values.map(String).filter(value => value.startsWith(prefix));
  }
  return [...Object.keys(options).map(key => `--${key}`), "--help", "--version"].filter(key => key.startsWith(prefix)).sort();
}

export function completionScript(shell: string): string {
  switch (shell) {
    case "bash": return `_idk_complete() {\n  COMPREPLY=()\n  local candidate\n  while IFS= read -r candidate; do\n    COMPREPLY+=("$candidate")\n  done < <(idk complete -- "\${COMP_WORDS[@]:1}")\n}\ncomplete -F _idk_complete idk\n`;
    case "zsh": return `#compdef idk\n_idk_complete() {\n  local -a candidates\n  candidates=("\${(@f)$(idk complete -- "\${words[@]:1}")}")\n  compadd -- "\${candidates[@]}"\n}\nautoload -Uz compinit\n(( $+functions[compdef] )) || compinit\ncompdef _idk_complete idk\n`;
    case "fish": return `function __idk_complete\n  idk complete -- (commandline -opc)[2..-1] (commandline -ct)\nend\ncomplete -c idk -f -a '(__idk_complete)'\n`;
    case "powershell": return `Register-ArgumentCompleter -Native -CommandName idk -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  $words = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text })\n  if ($words.Count -eq 0 -or $words[-1] -ne $wordToComplete) { $words += $wordToComplete }\n  idk complete -- @words | ForEach-Object {\n    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)\n  }\n}\n`;
    default: throw usageError("Supported completion shells: bash, zsh, fish, powershell.");
  }
}

export function completionCommands(commands: readonly CommandDefinition[]): CommandDefinition[] {
  return [
    defineCommand({ name: "completions", description: "Print shell completion scripts",
      async handler({ positional }) {
        if (positional.length !== 1) throw usageError("Usage: idk completions <bash|zsh|fish|powershell>");
        await writeStdout(completionScript(positional[0]!));
      },
    }),
    defineCommand({ name: "complete", description: "Return completion candidates for shell integration",
      async handler({ positional }) {
        const candidates = completionCandidates(commands, positional);
        await writeStdout(candidates.length ? candidates.join("\n") + "\n" : "");
      },
    }),
  ];
}
