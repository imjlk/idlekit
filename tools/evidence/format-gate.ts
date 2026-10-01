import { readFileSync } from "fs";
import { join } from "path";
import formatConfig from "../../lint.format.config";
import { root } from "../evidence-host";

export const formatIncludeRoots = [
  "evidence.config.ts",
  "lint.config.ts",
  "lint.format.config.ts",
  "tools/evidence-host.ts",
  "tools/evidence-inventory.ts",
  "tools/evidence/citations.ts",
  "tools/evidence/claims.ts",
  "tools/evidence/commands.ts",
  "tools/evidence/coverage.ts",
  "tools/evidence/format-gate.ts",
  "tools/evidence/junit.ts",
  "tools/evidence/lex.ts",
  "tools/evidence/markdown.ts",
  "tools/evidence/model.ts",
  "tools/evidence/program.ts",
  "tools/evidence/runner-bind.ts",
  "tools/evidence/runner-registry.ts",
  "tools/evidence/source-graph.ts",
  "tools/evidence-check.ts",
  "tools/evidence-smoke.ts",
  "tools/format-check.ts",
];

function segmentGlob(pattern: string, part: string): boolean {
  if (pattern === "*") return true;
  const source = pattern
    .split("*")
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`).test(part);
}

/** `**` matches any number of directories, including none. `*` stays in one segment. */
function excludeGlobMatches(pattern: readonly string[], parts: readonly string[]): boolean {
  let patternIndex = 0;
  let partIndex = 0;
  let star = -1;
  let mark = -1;
  while (partIndex < parts.length) {
    const token = pattern[patternIndex];
    if (patternIndex < pattern.length && token === "**") {
      star = patternIndex;
      mark = partIndex;
      patternIndex += 1;
      continue;
    }
    if (
      patternIndex < pattern.length &&
      token !== undefined &&
      segmentGlob(token, parts[partIndex] ?? "")
    ) {
      patternIndex += 1;
      partIndex += 1;
      continue;
    }
    if (star < 0) return false;
    patternIndex = star + 1;
    mark += 1;
    partIndex = mark;
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === "**") patternIndex += 1;
  return patternIndex === pattern.length;
}

function lastGlobSegment(glob: string): string {
  return glob.split("/").at(-1) ?? glob;
}

/**
 * Exact path, basename, `*` / `**` glob, or an extensionless directory.
 * `tools` excludes `tools/evidence-smoke.ts`. A trailing slash does too.
 */
function formatExcludeDropsRoot(pattern: string, rel: string): boolean {
  const glob = pattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (glob.length === 0 || glob === ".") return false;
  const rooted = glob.includes("/") ? glob : `**/${glob}`;
  const parts = rel.split("/");
  if (excludeGlobMatches(rooted.split("/"), parts)) return true;
  const fileLike = glob.includes("*") || lastGlobSegment(glob).includes(".");
  if (fileLike) return false;
  return excludeGlobMatches(`${rooted}/**`.split("/"), parts);
}

/** Root format config must lint these roots and fail when a file is unformatted. */
export function formatGateFailures(options?: { tsconfigText?: string; severity?: unknown }): string[] {
  const text = options?.tsconfigText ?? readFileSync(join(root, "tsconfig.format.json"), "utf8");
  const failures: string[] = [];
  let plugins: Array<{ transform?: string; configFile?: string; enabled?: boolean }> = [];
  let include: unknown;
  let exclude: unknown;
  try {
    const parsed = JSON.parse(text) as {
      compilerOptions?: {
        plugins?: Array<{ transform?: string; configFile?: string; enabled?: boolean }>;
      };
      include?: unknown;
      exclude?: unknown;
    };
    plugins = parsed.compilerOptions?.plugins ?? [];
    include = parsed.include;
    exclude = parsed.exclude;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const lint = plugins.find((plugin) => plugin.transform === "@ttsc/lint");
  if (!lint || lint.enabled === false || lint.configFile !== "./lint.format.config.ts") {
    failures.push("tsconfig.format.json must enable @ttsc/lint for lint.format.config.ts");
  }
  if (!Array.isArray(include)) {
    failures.push("tsconfig.format.json must include the format roots");
  } else {
    for (const rel of formatIncludeRoots) {
      if (!include.includes(rel)) failures.push(`tsconfig.format.json include dropped ${rel}`);
    }
  }
  if (exclude !== undefined) {
    const patterns = Array.isArray(exclude) ? exclude : [];
    const strings = patterns.every((entry) => typeof entry === "string");
    if (!Array.isArray(exclude) || !strings) {
      failures.push("tsconfig.format.json exclude must be a list of strings");
    } else {
      for (const rel of formatIncludeRoots) {
        if (patterns.some((pattern) => formatExcludeDropsRoot(pattern, rel))) {
          failures.push(`tsconfig.format.json exclude dropped ${rel}`);
        }
      }
    }
  }
  const severity = options?.severity ?? formatConfig.format?.severity;
  if (severity !== "error") failures.push("format.severity must be error");
  return failures;
}
