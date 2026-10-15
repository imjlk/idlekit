import { resolve } from "path";
import { realpath, stat } from "fs/promises";
import { usageError } from "../errors";
import type { OutputMeta } from "./outputMeta";
import { writeStdout, writeTextFile } from "../runtime/bun";

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

  const abs = resolve(args.outPath);
  for (const input of args.protectedInputs ?? []) {
    const source = resolve(input);
    let same = source === abs;
    if (!same) {
      try {
        const [outputReal, inputReal, outputStat, inputStat] = await Promise.all([
          realpath(abs), realpath(source), stat(abs, { bigint: true }), stat(source, { bigint: true }),
        ]);
        same = outputReal === inputReal || (outputStat.ino !== 0n && outputStat.dev === inputStat.dev && outputStat.ino === inputStat.ino);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      }
    }
    if (same) throw usageError(`Output path must not overwrite an input file: ${input}`);
  }
  await writeTextFile(abs, body);
  console.log(`Wrote ${args.format} output to ${abs}`);
}
