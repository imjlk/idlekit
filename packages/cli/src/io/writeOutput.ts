import { resolve } from "path";
import { realpath, stat } from "fs/promises";
import { usageError } from "../errors";
import type { OutputMeta } from "./outputMeta";
import { writeStdout, writeTextFile } from "../runtime/bun";
import { invocationInputCandidates } from "../runtime/invocation";

export type OutputFormat = "json" | "md" | "csv";

function toCsv(data: unknown): string {
  if (!Array.isArray(data)) {
    return `value\n${JSON.stringify(data)}`;
  }

  if (data.length === 0) return "";

  const first = data[0];
  if (typeof first !== "object" || first === null) {
    return ["value", ...data.map((x) => JSON.stringify(x))].join("\n");
  }

  const keys = Object.keys(first as Record<string, unknown>);
  const rows = [keys.join(",")];

  for (const row of data) {
    const r = row as Record<string, unknown>;
    rows.push(
      keys
        .map((k) => {
          const v = r[k];
          const raw = v === undefined ? "" : String(v);
          if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
            return `"${raw.replaceAll('"', '""')}"`;
          }
          return raw;
        })
        .join(","),
    );
  }

  return rows.join("\n");
}

function toMarkdown(data: unknown): string {
  if (typeof data === "string") return data;
  if (!Array.isArray(data)) {
    return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }

  if (data.length === 0) return "_No data_";

  const first = data[0];
  if (typeof first !== "object" || first === null) {
    return data.map((x, i) => `${i + 1}. ${String(x)}`).join("\n");
  }

  const keys = Object.keys(first as Record<string, unknown>);
  const head = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const rows = data.map((row) => {
    const r = row as Record<string, unknown>;
    return `| ${keys.map((k) => String(r[k] ?? "")).join(" | ")} |`;
  });

  return [head, sep, ...rows].join("\n");
}

export function renderOutput(format: OutputFormat, data: unknown): string {
  if (format === "csv") return toCsv(data);
  if (format === "md") return toMarkdown(data);
  return JSON.stringify(data, null, 2);
}

async function sameFile(output: string, input: string): Promise<boolean> {
  try {
    const [outputReal, inputReal, outputStat, inputStat] = await Promise.all([
      realpath(output), realpath(input), stat(output, { bigint: true }), stat(input, { bigint: true }),
    ]);
    return outputReal === inputReal || (outputStat.ino !== 0n && outputStat.dev === inputStat.dev && outputStat.ino === inputStat.ino);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return false;
  }
}

// A flag value may be JSON, a number, or any other text that stat rejects for a reason other than ENOENT.
async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/**
 * Resolve an output path and refuse one that names an input file, through a symlink or a hard link too.
 * `protectedInputs` are always protected. The command's positionals and non-output string flags are
 * protected when they name an existing file, so a flag value that is not a path never blocks a write.
 * `allowFlags` names input flags the output may replace on purpose.
 */
export async function assertOutputNotInput(
  outPath: string,
  options: { protectedInputs?: readonly string[]; allowFlags?: readonly string[] } = {},
): Promise<string> {
  const abs = resolve(outPath);
  const explicit = (options.protectedInputs ?? []).map((input) => ({ input, required: true }));
  const implicit = invocationInputCandidates({ allow: options.allowFlags }).map((input) => ({ input, required: false }));
  for (const { input, required } of [...explicit, ...implicit]) {
    const source = resolve(input);
    if (!required && !(await exists(source))) continue;
    if (source === abs || (await sameFile(abs, source))) {
      throw usageError(`Output path must not overwrite an input file: ${input}`);
    }
  }
  return abs;
}

export async function writeOutput(args: {
  format: OutputFormat;
  data: unknown;
  outPath?: string;
  meta?: OutputMeta;
  protectedInputs?: readonly string[];
}): Promise<void> {
  const dataWithMeta =
    args.meta &&
    args.format === "json" &&
    typeof args.data === "object" &&
    args.data !== null &&
    !Array.isArray(args.data)
      ? {
          ...(args.data as Record<string, unknown>),
          _meta: args.meta,
        }
      : args.data;
  const body = renderOutput(args.format, dataWithMeta);

  if (!args.outPath) {
    await writeStdout(`${body}\n`);
    return;
  }

  const abs = await assertOutputNotInput(args.outPath, { protectedInputs: args.protectedInputs });
  await writeTextFile(abs, body);
  console.log(`Wrote ${args.format} output to ${abs}`);
}
