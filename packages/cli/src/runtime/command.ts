import { cli as gunshiCli, define, plugin, type ArgSchema, type Command, type CommandContext } from "gunshi";
import { renderUsage } from "gunshi/renderer";
import completion from "@gunshi/plugin-completion";
import { suggestion } from "@gunshi/plugin-suggestion";
import { z } from "zod";
import { usageError } from "../errors";
import { getTerminalInfo, prompt, type PromptApi, type TerminalInfo } from "./prompt";
export type { PromptApi, TerminalInfo } from "./prompt";

export type Option<T = unknown> = Readonly<{ schema: z.ZodType<T>; description?: string }>;
type Options = Record<string, Option<any>>;
type Values<T extends Options> = { [K in keyof T]: T[K] extends Option<infer V> ? V : never };
export type HandlerArgs<F = Record<string, unknown>> = {
  flags: F; positional: string[]; terminal: TerminalInfo; prompt: PromptApi;
  cwd: string; runtime: { args: string[] };
};
type Definition<T extends Options> = {
  name: string; description: string; options?: T;
  handler(args: HandlerArgs<Values<T>>): unknown | Promise<unknown>;
};
export type CommandDefinition = Definition<any> & { commands?: readonly CommandDefinition[] };
export function option<T>(schema: z.ZodType<T>, metadata: { description?: string } = {}): Option<T> {
  return { schema, ...metadata };
}
export function defineCommand<T extends Options = {}>(definition: Definition<T>): Definition<T> { return definition; }
export function defineGroup(definition: { name: string; description: string; commands: readonly CommandDefinition[] }): CommandDefinition {
  return { ...definition, handler() {} };
}
export function optionShape(option: Option): { type?: string; enum?: readonly unknown[]; default?: unknown } {
  return z.toJSONSchema(option.schema, { unrepresentable: "any" }) as ReturnType<typeof optionShape>;
}
export function commandOptions(command: CommandDefinition): Options { return command.options ?? {}; }

/** Preserve explicit boolean values and negative option values for existing callers. */
function normalizeOptions(argv: string[], options: Options): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") { result.push(...argv.slice(index)); break; }
    const match = /^--(no-)?([^=]+)(?:=(.*))?$/.exec(token);
    const key = match?.[2];
    if (!key || !options[key] || optionShape(options[key]!).type !== "boolean") {
      if (key && options[key] && match![3] === undefined && /^-\d/.test(argv[index + 1] ?? "")) result.push(`${token}=${argv[++index]}`);
      else result.push(token === "-v" ? "--version" : token);
      continue;
    }
    let value = match![3];
    if (value === undefined && /^(true|false)$/.test(argv[index + 1] ?? "")) value = argv[++index];
    if (value !== undefined && value !== "true" && value !== "false") throw usageError(`Invalid --${key}: expected true or false`);
    result.push(`--${match![1] || value === "false" ? "no-" : ""}${key}`);
  }
  return result;
}

/** Completion 0.37.3 gives Tab a value handler even for native boolean args. */
function normalizeCompletionBooleans(argv: string[], options: Options): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") { result.push(...argv.slice(index)); break; }
    const match = /^--(no-)?([^=]+)(?:=(true|false))?$/.exec(token);
    const key = match?.[2];
    // The last word is the cursor prefix, rather than a completed switch.
    if (index === argv.length - 1 || !key || !options[key] || optionShape(options[key]!).type !== "boolean") {
      result.push(token); continue;
    }
    let value = match![3];
    if (value === undefined && index + 1 < argv.length - 1 && /^(true|false)$/.test(argv[index + 1]!)) value = argv[++index];
    result.push(`--${key}=${match![1] || value === "false" ? "false" : "true"}`);
  }
  return result;
}

let names: readonly string[] = [];
export function commandNames(): readonly string[] { return names; }

/** Add the existing structured stderr contract after Gunshi's suggestion renderer. */
function errorContract() {
  return plugin({ id: "idlekit:error-contract", name: "idlekit error contract", dependencies: ["g:suggestion"], setup(ctx) {
    ctx.decorateValidationErrorsRenderer(async (base, context, error) => { throw usageError(await base(context, error)); });
  } });
}

/** Gunshi owns command-tree routing, parsing, help, completion, and typo suggestions. */
export async function createCLI(config: { name: string; version: string; description?: string }) {
  const commands: CommandDefinition[] = [];
  const nativeOptions: Options = {};
  const completionConfig: Record<string, { args: Record<string, { handler: () => { value: string }[] }> }> = {};
  const toNative = (selected: CommandDefinition, path: string[]): Command => {
    const options = commandOptions(selected);
    Object.assign(nativeOptions, options);
    const args: Record<string, ArgSchema> = {};
    const handlers: Record<string, { handler: () => { value: string }[] }> = {};
    for (const [key, opt] of Object.entries(options)) {
      const shape = optionShape(opt);
      const defaultValue = opt.schema.safeParse(undefined);
      const metadata = { description: opt.description,
        required: !defaultValue.success,
        ...(defaultValue.success && defaultValue.data !== undefined ? { default: defaultValue.data } : {}),
      };
      args[key] = shape.type === "boolean" ? { ...metadata, type: "boolean", negatable: true } : { ...metadata, type: "custom",
        parse(value) {
          const parsed = opt.schema.safeParse(value);
          if (!parsed.success) throw usageError(`Invalid --${key}: ${parsed.error.message}`);
          return parsed.data;
        },
      };
      const values = shape.type === "boolean" ? [] : shape.enum ?? [];
      if (values.length) handlers[key] = { handler: () => values.map(value => ({ value: String(value) })) };
    }
    completionConfig[path.join(" ")] = { args: handlers };
    return define({ name: selected.name, description: selected.description, args,
      ...(selected.commands ? { subCommands: new Map(selected.commands.map(child => [child.name, toNative(child, [...path, child.name])])) } : {}),
      async run(ctx) {
        if (selected.commands) throw usageError(`Choose a ${selected.name} subcommand. Use --help to list commands.`);
        const flags: Record<string, unknown> = {};
        for (const [key, opt] of Object.entries(options)) {
          const parsed = opt.schema.safeParse(ctx.values[key]);
          if (!parsed.success) throw usageError(`Invalid --${key}: ${parsed.error.message}`);
          flags[key] = parsed.data;
        }
        await selected.handler({ flags, positional: [...ctx.positionals.slice(ctx.commandPath.length), ...ctx.rest], terminal: getTerminalInfo(), prompt,
          cwd: process.cwd(), runtime: { args: [...ctx._] },
        });
      },
    });
  };
  const getEntry = () => define({ name: config.name, description: config.description ?? "", subCommands: new Map(commands.map(command => [command.name, toNative(command, [command.name])])),
    run() { throw usageError("Choose a command. Use --help to list commands."); },
  });
  const options = (entry: Command = getEntry()) => ({
    ...config, strict: true, renderHeader: null,
    subCommands: entry.subCommands,
    renderUsage: async (ctx: Readonly<CommandContext>) => (await renderUsage(ctx)).replace(/^OPTIONS:?$/gm, "Options:"),
    plugins: [completion({ config: { subCommands: completionConfig } }), suggestion({ maxSuggestions: 3 }), errorContract()],
  });
  const run = async (input: string[]) => {
    let argv = input[0] === "help" ? [...input.slice(1), "--help"] : input.length ? input : ["--help"];
    // Keep installed setup blocks from older releases usable.
    if (argv[0] === "completions") {
      if (argv.length !== 2 || !["bash", "zsh", "fish", "powershell"].includes(argv[1]!)) throw usageError("Usage: idk completions <bash|zsh|fish|powershell>");
      argv = ["complete", argv[1]!];
    }
    const entry = getEntry();
    const normalized = argv[0] === "complete" && argv[1] === "--"
      ? ["complete", "--", ...normalizeCompletionBooleans(argv.slice(2), nativeOptions)]
      : normalizeOptions(argv, nativeOptions);
    await gunshiCli(normalized, entry, options(entry));
    // Preserve Tab's generated function and options while enabling filename fallback.
    if (argv.length === 2 && argv[0] === "complete" && argv[1] === "bash") {
      const identifier = config.name.replace(/[^a-zA-Z0-9_]/g, "_");
      console.log(`__${identifier}_completion_registration=$(complete -p ${config.name})
__${identifier}_gunshi_completion_function=\${__${identifier}_completion_registration#* -F }
__${identifier}_gunshi_completion_function=\${__${identifier}_gunshi_completion_function%% *}
__${identifier}_complete_with_files() {
  "$__${identifier}_gunshi_completion_function" "$@"
  if [[ \${#COMPREPLY[@]} -eq 0 ]] && type -t compopt >/dev/null 2>&1; then
    compopt -o default -o bashdefault
  fi
}
__${identifier}_completion_registration=\${__${identifier}_completion_registration/-F $__${identifier}_gunshi_completion_function/-F __${identifier}_complete_with_files}
eval "\${__${identifier}_completion_registration/#complete /complete -o default -o bashdefault }"
unset __${identifier}_completion_registration`);
    }
  };
  return {
    command(command: CommandDefinition) { commands.push(command); names = [...commands.map(item => item.name), "complete", "completions"]; },
    run, commands, getEntry, options,
    execute(command: string, args: string[]) { return run([...command.split(" "), ...args]); },
  };
}
