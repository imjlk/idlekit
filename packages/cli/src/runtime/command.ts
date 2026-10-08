import { cli as gunshiCli, define, type ArgSchema } from "gunshi";
import { z } from "zod";
import type { ReactNode } from "react";
import { usageError } from "../errors";
import { getTerminalInfo, prompt, type PromptApi, type TerminalInfo } from "./prompt";
import type { ResolvedTuiImageOptions } from "./tui";
export type { PromptApi, TerminalInfo } from "./prompt";
export type { ResolvedTuiImageOptions } from "./tui";

export type Option<T = unknown> = Readonly<{ schema: z.ZodType<T>; description?: string }>;
type Options = Record<string, Option<any>>;
type Values<T extends Options> = { [K in keyof T]: T[K] extends Option<infer V> ? V : never };
export type RenderArgs<F = Record<string, unknown>> = {
  flags: F; positional: string[]; terminal: TerminalInfo; prompt: PromptApi;
  cwd: string; runtime: { args: string[] }; image: ResolvedTuiImageOptions;
  command: { name: string };
};
type Definition<T extends Options> = {
  name: string; description: string; options?: T;
  handler(args: RenderArgs<Values<T>>): unknown | Promise<unknown>;
  render?(args: RenderArgs<Values<T>>): ReactNode;
  tui?: { renderer?: { bufferMode?: string } };
};
export type CommandDefinition = Definition<any> & { commands?: readonly CommandDefinition[] };

export function option<T>(schema: z.ZodType<T>, metadata: { description?: string } = {}): Option<T> {
  return { schema, ...metadata };
}

export function defineCommand<T extends Options = {}>(definition: Definition<T>): Definition<T> {
  return definition;
}

export function defineGroup(definition: { name: string; description: string; commands: readonly CommandDefinition[] }): CommandDefinition {
  return { ...definition, handler() {} };
}

export function optionShape(option: Option): { type?: string; enum?: readonly unknown[]; default?: unknown } {
  return z.toJSONSchema(option.schema, { unrepresentable: "any" }) as ReturnType<typeof optionShape>;
}

const IMAGE_OPTIONS = {
  "image-mode": option(z.enum(["auto", "on", "off"]).default("auto"), { description: "Terminal image preview mode" }),
  "image-protocol": option(z.enum(["auto", "kitty", "iterm2", "sixel"]).default("auto"), { description: "Terminal image protocol" }),
  "image-width": option(z.coerce.number().int().positive().optional(), { description: "Image width in terminal cells" }),
  "image-height": option(z.coerce.number().int().positive().optional(), { description: "Image height in terminal cells" }),
};

export function commandOptions(command: CommandDefinition): Options {
  return { ...command.options, ...(command.render ? IMAGE_OPTIONS : {}) };
}

/** Preserve explicit true/false and bare switches before Gunshi parses options. */
function normalizeBooleans(argv: string[], options: Options): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") { result.push(...argv.slice(index)); break; }
    const match = /^--(no-)?([^=]+)(?:=(.*))?$/.exec(token);
    const key = match?.[2];
    if (!key || !options[key] || optionShape(options[key]!).type !== "boolean") {
      if (key && options[key] && match![3] === undefined && /^-\d/.test(argv[index + 1] ?? "")) result.push(`${token}=${argv[++index]}`);
      else result.push(token);
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

/** Gunshi owns argument parsing, validation dispatch, help, and version handling. */
export async function createCLI(config: { name: string; version: string; description?: string; generated?: boolean }, hooks: {
  getTerminalInfo?: () => TerminalInfo;
  runTuiRender?: (args: RenderArgs<any>) => Promise<void>;
} = {}) {
  const commands: CommandDefinition[] = [];
  const lookup = (argv: string[]) => {
    let scope = commands, command: CommandDefinition | undefined;
    const path: string[] = [];
    let index = 0;
    while (argv[index] && !argv[index]!.startsWith("-")) {
      const selected = scope.find(item => item.name === argv[index]);
      if (!selected) {
        if (!command || command.commands) throw usageError(`Unknown command: ${[...path, argv[index]].join(" ")}`);
        break;
      }
      command = selected; path.push(command.name); index++;
      if (!command.commands) break;
      scope = [...command.commands];
    }
    return { command, path, args: argv.slice(index), scope };
  };
  const help = (command: CommandDefinition | undefined, path: string[]) => {
    const lines = [`Usage: ${config.name}${path.length ? " " + path.join(" ") : ""} [options]`, "", command?.description ?? config.description ?? ""];
    const children = command?.commands ?? (!command ? commands : []);
    if (children.length) lines.push("", "Commands:", ...children.map(item => `  ${item.name.padEnd(18)}${item.description}`));
    lines.push("", "Options:", "  -h, --help        Show help", "  -v, --version     Show version");
    if (command) for (const [key, opt] of Object.entries(commandOptions(command))) lines.push(`  --${key.padEnd(22)}${opt.description ?? ""}`);
    return lines.join("\n") + "\n";
  };
  const run = async (input: string[]) => {
    const argv = input[0] === "help" ? [...input.slice(1), "--help"] : input.length ? input : ["--help"];
    const { command, path, args } = lookup(argv);
    if (argv.includes("-v")) { console.log(config.version); return; }
    const selected = command ?? { name: config.name, description: config.description ?? "", handler() {} };
    const options = commandOptions(selected);
    const argsSchema: Record<string, ArgSchema> = {};
    for (const [key, opt] of Object.entries(options)) {
      const shape = optionShape(opt);
      argsSchema[key] = { type: "custom", description: opt.description,
        parse(value) {
          const input = shape.type === "boolean" ? value === "true" ? true : value === "false" ? false : value : value;
          const parsed = opt.schema.safeParse(input);
          if (!parsed.success) throw usageError(`Invalid --${key}: ${parsed.error.message}`);
          return parsed.data;
        },
      };
    }
    const nativeCommand = define({ name: selected.name, description: selected.description, args: argsSchema,
      async run(ctx) {
        if (selected.commands) throw usageError(`Choose a ${selected.name} subcommand. Use --help to list commands.`);
        const flags: Record<string, unknown> = {};
        for (const [key, opt] of Object.entries(options)) {
          const parsed = opt.schema.safeParse(ctx.values[key]);
          if (!parsed.success) throw usageError(`Invalid --${key}: ${parsed.error.message}`);
          flags[key] = parsed.data;
        }
        const terminal = (hooks.getTerminalInfo ?? getTerminalInfo)();
        const context: RenderArgs<any> = {
          flags, positional: [...ctx.positionals, ...ctx.rest], terminal, prompt,
          cwd: process.cwd(), runtime: { args }, command: selected,
          image: { mode: flags["image-mode"] as ResolvedTuiImageOptions["mode"] ?? "auto", protocol: flags["image-protocol"] as ResolvedTuiImageOptions["protocol"] ?? "auto", width: flags["image-width"] as number | undefined, height: flags["image-height"] as number | undefined },
        };
        await selected.handler(context);
        if (selected.render) {
          if (hooks.runTuiRender) await hooks.runTuiRender(context);
          else { const { runTui } = await import("./tui"); await runTui(selected.render(context)); }
        }
      },
    });
    await gunshiCli(normalizeBooleans(args, options), nativeCommand, {
      name: config.name, version: config.version, strict: true, renderHeader: null,
      renderUsage: async () => help(command, path),
      renderValidationErrors: async (_ctx, error) => { throw usageError(error.errors.map((item: Error) => item.message).join("; ") || error.message); },
    });
  };
  return {
    command(command: CommandDefinition) { commands.push(command); names = commands.map(item => item.name); },
    run,
    execute(command: string, args: string[]) { return run([...command.split(" "), ...args]); },
    commands,
  };
}
