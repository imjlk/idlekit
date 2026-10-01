import { dirname, relative, resolve } from "path";
import { root } from "../evidence-host";

import { insideSpan, skipQuoted, stringSpans } from "./lex";

export function exportsNamedFunction(body: string, name: string): boolean {
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(body);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `quota` must not match a citation of `quota-v2`. */
function citesAnchor(text: string, doc: string, anchor: string): boolean {
  const pattern = `@evidence ${escapeRegExp(doc)}#${escapeRegExp(anchor)}(?![A-Za-z0-9._:-])`;
  return new RegExp(pattern).test(text);
}

/** The block comment immediately above this export, ignoring matches inside strings. */
function adjacentExportComment(body: string, exportName: string): string | undefined {
  const fn = escapeRegExp(exportName);
  const pattern = new RegExp(
    `\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*)\\*\\/\\s*export\\s+(?:async\\s+)?function\\s+${fn}\\b`,
    "g",
  );
  const hidden = stringSpans(body);
  for (const match of body.matchAll(pattern)) {
    if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
    return match[1];
  }
  return undefined;
}

/** The doc comment on the exported test must cite this requirement, not only share its file. */
export function citesRequirement(
  body: string,
  exportName: string,
  doc: string,
  anchor: string,
): boolean {
  const comment = adjacentExportComment(body, exportName);
  return comment !== undefined && citesAnchor(comment, doc, anchor);
}

function evidenceTargets(comment: string): string[] {
  const targets: string[] = [];
  for (const match of comment.matchAll(/@evidence\s+(\S+)/g)) {
    if (match[1]) targets.push(match[1]);
  }
  return targets;
}

function isRequirementTarget(target: string, doc: string, anchor: string): boolean {
  const pattern = `^${escapeRegExp(doc)}#${escapeRegExp(anchor)}(?![A-Za-z0-9._:-])`;
  return new RegExp(pattern).test(target);
}

function isImplementationTarget(target: string, doc: string, anchor: string): boolean {
  if (isRequirementTarget(target, doc, anchor)) return false;
  return target.includes(".ts#") || target.startsWith("./") || target.startsWith("../");
}

function citedPath(target: string, testFile: string): string | undefined {
  const pathPart = target.split("#")[0]?.replaceAll("\\", "/");
  if (!pathPart) return undefined;
  if (pathPart.startsWith("./") || pathPart.startsWith("../")) {
    return relative(root, resolve(root, dirname(testFile), pathPart)).replaceAll("\\", "/");
  }
  if (pathPart.endsWith(".ts") || pathPart.endsWith(".tsx")) return pathPart;
  return undefined;
}

function citesProduction(target: string, testFile: string, production: readonly string[]): boolean {
  const cited = citedPath(target, testFile);
  return cited !== undefined && production.some((host) => host.replaceAll("\\", "/") === cited);
}

export type ImplementationHostGap =
  | ""
  | undefined
  | { kind: "unregistered" | "foreign"; name: string };

/** Inventoried exports must cite this requirement's production hosts, not another requirement's. */
export function unregisteredImplementationHost(
  body: string,
  doc: string,
  anchor: string,
  registered: readonly string[],
  scope: { file: string; production: readonly string[]; fileRegistered?: readonly string[] } = {
    file: "test.ts",
    production: [],
  },
): ImplementationHostGap {
  const names = new Set(scope.fileRegistered ?? registered);
  const own = new Set(registered);
  const hidden = stringSpans(body);
  const covered = new Set<string>();
  for (const match of body.matchAll(
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
  )) {
    if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
    const comment = match[1] ?? "";
    const name = match[2];
    if (!name) continue;
    const implementation = evidenceTargets(comment).filter((target) =>
      isImplementationTarget(target, doc, anchor),
    );
    if (!names.has(name)) {
      if (implementation.length > 0) return { kind: "unregistered", name };
      continue;
    }
    if (!own.has(name)) continue;
    if (implementation.length === 0) continue;
    if (implementation.some((target) => !citesProduction(target, scope.file, scope.production))) {
      return { kind: "foreign", name };
    }
    covered.add(name);
  }
  for (const name of registered) {
    if (!covered.has(name)) return "";
  }
  return undefined;
}

/** Two inventory rows must not claim the same active heading. */
export function duplicateRequirementAnchors(
  requirements: readonly { doc: string; anchor: string }[],
): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const requirement of requirements) {
    const pair = `${requirement.doc}#${requirement.anchor}`;
    if (seen.has(pair)) duplicates.push(pair);
    else seen.add(pair);
  }
  return duplicates;
}

function skipTemplate(body: string, index: number): number {
  let cursor = index + 1;
  while (cursor < body.length) {
    const char = body[cursor] ?? "";
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "`") return cursor + 1;
    if (char === "$" && body[cursor + 1] === "{") {
      cursor += 2;
      let depth = 1;
      while (cursor < body.length && depth > 0) {
        const nested = body[cursor] ?? "";
        if (nested === "'" || nested === '"') {
          cursor = skipQuoted(body, cursor);
          continue;
        }
        if (nested === "`") {
          cursor = skipTemplate(body, cursor);
          continue;
        }
        if (nested === "/" && body[cursor + 1] === "/") {
          const next = body.indexOf("\n", cursor);
          cursor = next < 0 ? body.length : next + 1;
          continue;
        }
        if (nested === "/" && body[cursor + 1] === "*") {
          const next = body.indexOf("*/", cursor + 2);
          cursor = next < 0 ? body.length : next + 2;
          continue;
        }
        if (nested === "{") depth += 1;
        else if (nested === "}") depth -= 1;
        cursor += 1;
      }
      continue;
    }
    cursor += 1;
  }
  return cursor;
}

function exportedContainerHeader(body: string, brace: number): boolean {
  const head = body.slice(Math.max(0, brace - 240), brace).trimEnd();
  const lead = "(?:^|[^\\w$])export\\s+(?:default\\s+)?";
  const mods = "(?:(?:declare|abstract)\\s+)*";
  const kind = "(?:class|interface)\\b[^;{}]*$";
  return new RegExp(`${lead}${mods}${kind}`).test(head);
}

/** True when `index` is a direct member of an exported class or interface. */
function directExportedMember(body: string, index: number): boolean {
  let depth = 0;
  const containers: number[] = [];
  let cursor = 0;
  while (cursor < index) {
    const char = body[cursor] ?? "";
    if (char === "/" && body[cursor + 1] === "/") {
      const next = body.indexOf("\n", cursor);
      cursor = next < 0 ? body.length : next + 1;
      continue;
    }
    if (char === "/" && body[cursor + 1] === "*") {
      const next = body.indexOf("*/", cursor + 2);
      cursor = next < 0 ? body.length : next + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      cursor = skipQuoted(body, cursor);
      continue;
    }
    if (char === "`") {
      cursor = skipTemplate(body, cursor);
      continue;
    }
    if (char === "{") {
      if (exportedContainerHeader(body, cursor)) containers.push(depth + 1);
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}") {
      depth = Math.max(0, depth - 1);
      let openDepth = containers[containers.length - 1];
      while (openDepth !== undefined && openDepth > depth) {
        containers.pop();
        openDepth = containers[containers.length - 1];
      }
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  return containers.includes(depth);
}

/** Public field or interface property. Accessors and private members stay out. */
function propertyDeclarationFollows(after: string): boolean {
  const text = after.replace(/^(?:\s|\/\/[^\n]*(?:\n|$))*/, "");
  if (/^(?:private|protected|get|set|accessor)\b/.test(text)) return false;
  if (text.startsWith("#") || text.startsWith("[")) return false;
  if (/^static\s*\{/.test(text)) return false;
  const modifiers = "(?:(?:public|readonly|static|abstract|declare|override)\\s+)*";
  const name = "[A-Za-z_$][\\w$]*\\s*";
  const tail = "(?:[?!]?\\s*:|[?!]?\\s*=|[?!]?\\s*;)";
  return new RegExp(`^${modifiers}${name}${tail}`).test(text);
}

export function productionFileCites(body: string, doc: string, anchor: string): boolean {
  const hidden = stringSpans(body);
  for (const match of body.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\//g)) {
    if (!match[1] || match.index === undefined || insideSpan(hidden, match.index)) continue;
    if (!citesAnchor(match[1], doc, anchor)) continue;
    const after = body.slice(match.index + match[0].length);
    // A // note may sit between the doc block and the export. Another block comment may not.
    const exportFollows = new RegExp(
      "^(?:\\s|//[^\\n]*(?:\\n|$))*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const)\\b",
    );
    if (exportFollows.test(after)) return true;
    if (propertyDeclarationFollows(after) && directExportedMember(body, match.index)) return true;
  }
  return false;
}
