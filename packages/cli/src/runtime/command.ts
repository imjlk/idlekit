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
    result.push(`--${key}`, match![1] ? "false" : value ?? "true");
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
      args[key] = { type: "custom", description: opt.description,
        required: !defaultValue.success,
        ...(defaultValue.success && defaultValue.data !== undefined ? { default: defaultValue.data } : {}),
        parse(value) {
          const input = shape.type === "boolean" ? value === "true" ? true : value === "false" ? false : value : value;
          const parsed = opt.schema.safeParse(input);
          if (!parsed.success) throw usageError(`Invalid --${key}: ${parsed.error.message}`);
          return parsed.data;
        },
      };
      const values = shape.enum ?? (shape.type === "boolean" ? ["true", "false"] : []);
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
    await gunshiCli(normalizeOptions(argv, nativeOptions), entry, options(entry));
    // Tab's Bash registration disables Readline filename completion by default.
    if (argv[0] === "complete" && argv[1] === "bash") {
      const identifier = config.name.replace(/[^a-zA-Z0-9_]/g, "_");
      console.log(`complete -o default -o bashdefault -F __${identifier}_complete ${config.name}`);
    }
  };
  return {
    command(command: CommandDefinition) { commands.push(command); names = [...commands.map(item => item.name), "complete", "completions"]; },
    run, commands, getEntry, options,
    execute(command: string, args: string[]) { return run([...command.split(" "), ...args]); },
  };
}
