import { resolve } from "path";
import type { OutputMeta } from "./outputMeta";
import { writeTextFile } from "../runtime/bun";

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
    console.log(body);
    return;
  }

  const abs = resolve(args.outPath);
  await writeTextFile(abs, body);
  console.log(`Wrote ${args.format} output to ${abs}`);
}
