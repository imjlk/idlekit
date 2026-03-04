import type {
  ListFormat,
  ModelsListOutput,
  ObjectivesListOutput,
  StrategiesListOutput,
} from "../commands/list/types";

function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  if (headers.length === 0) return "";

  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ];

  return lines.join("\n");
}

function toMdTable(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "| (empty) |\n|---|\n";
  const headers = Object.keys(rows[0] ?? {});
  if (headers.length === 0) return "| (empty) |\n|---|\n";

  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${headers.map((h) => String(r[h] ?? "")).join(" | ")} |`);

  return [head, sep, ...body].join("\n") + "\n";
}

export function renderModelsList(out: ModelsListOutput, format: ListFormat): string {
  if (format === "json") return `${JSON.stringify(out, null, 2)}\n`;
  const rows = out.models as unknown as Record<string, unknown>[];
  if (format === "csv") return `${toCsv(rows)}\n`;
  return toMdTable(rows);
}

export function renderStrategiesList(out: StrategiesListOutput, format: ListFormat): string {
  if (format === "json") return `${JSON.stringify(out, null, 2)}\n`;
  const rows = out.strategies as unknown as Record<string, unknown>[];
  if (format === "csv") return `${toCsv(rows)}\n`;
  return toMdTable(rows);
}

export function renderObjectivesList(out: ObjectivesListOutput, format: ListFormat): string {
  if (format === "json") return `${JSON.stringify(out, null, 2)}\n`;
  const rows = out.objectives as unknown as Record<string, unknown>[];
  if (format === "csv") return `${toCsv(rows)}\n`;
  return toMdTable(rows);
}
