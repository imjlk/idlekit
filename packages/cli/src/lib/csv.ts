import { cliError } from "../errors";

/** RFC 4180-style CSV rows: quoted commas, escaped quotes and multiline cells; blank rows are dropped. */
export function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') {
      const next = raw[i + 1];
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  if (inQuotes) {
    throw cliError("CLI_USAGE", "CSV parse error: unterminated quoted field");
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((x) => x.length > 0)) rows.push(row);
  }

  return rows;
}
