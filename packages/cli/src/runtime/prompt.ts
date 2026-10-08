import * as clack from "@clack/prompts";
import { usageError } from "../errors";

export type TerminalInfo = Readonly<{
  width: number; height: number; isInteractive: boolean; isCI: boolean;
  supportsColor: boolean; supportsMouse: boolean;
}>;

export interface PromptApi {
  intro(message: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  text(message: string, options?: { default?: string; placeholder?: string; validate?: (value: string) => boolean | string }): Promise<string>;
  select<T>(message: string, options: { options: readonly { value: T; label?: string; hint?: string }[]; default?: T }): Promise<T>;
  confirm(message: string, options?: { default?: boolean }): Promise<boolean>;
  group<T extends Record<string, () => Promise<unknown>>>(prompts: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
}

function result<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw usageError("Interactive setup cancelled.");
  return value as T;
}

export const prompt: PromptApi = {
  intro: clack.intro,
  outro: clack.outro,
  note: clack.note,
  async text(message, options = {}) {
    return result<string>(await clack.text({ message, placeholder: options.placeholder, defaultValue: options.default,
      validate(value) {
        const valid = options.validate?.(value ?? "");
        return valid === false ? "Invalid value" : typeof valid === "string" ? valid : undefined;
      },
    }));
  },
  async select<T>(message: string, options: { options: readonly { value: T; label?: string; hint?: string }[]; default?: T }) {
    const choices = options.options.map(item => ({ ...item, label: item.label ?? String(item.value) }));
    return result<T>(await clack.select<T>({ message, options: choices as Parameters<typeof clack.select<T>>[0]["options"], initialValue: options.default }));
  },
  async confirm(message, options = {}) {
    return result<boolean>(await clack.confirm({ message, initialValue: options.default }));
  },
  async group<T extends Record<string, () => Promise<unknown>>>(prompts: T) {
    const values: Record<string, unknown> = {};
    for (const [key, run] of Object.entries(prompts)) values[key] = await run();
    return values as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
  },
};

export function getTerminalInfo(): TerminalInfo {
  const isCI = Boolean(process.env.CI && process.env.CI !== "false");
  return {
    width: process.stdout.columns ?? 80, height: process.stdout.rows ?? 24,
    isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY), isCI,
    supportsColor: Boolean(process.stdout.isTTY && !process.env.NO_COLOR), supportsMouse: false,
  };
}
