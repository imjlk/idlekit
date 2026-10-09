export type NpmPackEntry = { name: string; version: string; filename: string; [key: string]: unknown };

export function parseNpmPackEntries(raw: string): NpmPackEntry[] {
  // Lifecycle scripts may print before npm's final JSON report.
  for (const start of raw.matchAll(/(^|\n)[ \t]*[\[{]/g)) {
    let report: unknown;
    try {
      report = JSON.parse(raw.slice(start.index! + start[1]!.length).trim());
    } catch {
      continue;
    }
    const entries: unknown[] = Array.isArray(report) ? report
      : report !== null && typeof report === "object" ? Object.values(report) : [];
    if (entries.length > 0 && entries.every((entry): entry is NpmPackEntry => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
      const value = entry as Record<string, unknown>;
      return ["name", "version", "filename"].every((key) => {
        const field = value[key];
        return typeof field === "string" && field.length > 0;
      });
    })) return entries;
  }
  throw new Error(`npm pack output did not include valid package metadata:\n${raw.slice(0, 2048)}`);
}
