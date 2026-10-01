import { evidenceGraph, productionFiles, testFiles } from "../../evidence.config";

import { fail } from "./program";

export function enabledMarkdownGlobs(): string[] {
  const globs: string[] = [];
  for (const claim of evidenceGraph.claims) {
    if (claim.disabled) continue;
    const references = Array.isArray(claim.reference) ? claim.reference : [claim.reference];
    for (const reference of references) {
      if (reference.type === "markdown") globs.push(...reference.files);
    }
  }
  return [...new Set(globs)];
}

export function claimFiles(): string[] {
  const files: string[] = [];
  for (const claim of evidenceGraph.claims) {
    if (claim.disabled) continue;
    files.push(...claim.files);
  }
  return files;
}

function samePopulation(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of right) {
    const count = counts.get(item);
    if (!count) return false;
    if (count === 1) counts.delete(item);
    else counts.set(item, count - 1);
  }
  return counts.size === 0;
}

function referencePopulation(reference: unknown): string[] {
  const references = Array.isArray(reference) ? reference : [reference];
  const files: string[] = [];
  for (const entry of references) {
    if (!entry || typeof entry !== "object" || !("files" in entry)) continue;
    const value = entry.files;
    if (!Array.isArray(value)) continue;
    for (const file of value) {
      if (typeof file === "string") files.push(file);
    }
  }
  return files;
}

const enabledClaimHosts = [
  {
    name: "active requirements have production implementations",
    type: "typescript",
    symbols: ["function", "property"],
    files: productionFiles,
    references: ["docs/requirements/active/**/*.md"],
    referenceType: "markdown",
    referenceSymbols: ["h2"],
  },
  {
    name: "active requirements have executed test hosts",
    type: "typescript",
    symbols: ["function"],
    files: testFiles,
    references: ["docs/requirements/active/**/*.md"],
    referenceType: "markdown",
    referenceSymbols: ["h2"],
  },
  {
    name: "executed tests cite the implementation they run",
    type: "typescript",
    symbols: ["function"],
    files: testFiles,
    references: productionFiles,
    referenceType: "typescript",
    referenceSymbols: ["property", "function"],
  },
] as const;

function symbolPopulation(symbol: unknown): string[] {
  if (typeof symbol === "string") return [symbol];
  if (!Array.isArray(symbol)) return [];
  const names: string[] = [];
  for (const item of symbol) {
    if (typeof item === "string") names.push(item);
  }
  return names;
}

function referenceEntries(reference: unknown): object[] {
  const references = Array.isArray(reference) ? reference : [reference];
  const entries: object[] = [];
  for (const entry of references) {
    if (entry && typeof entry === "object") entries.push(entry);
  }
  return entries;
}

function referenceTypes(reference: unknown): string[] {
  const types: string[] = [];
  for (const entry of referenceEntries(reference)) {
    const type = (entry as { type?: unknown }).type;
    if (typeof type === "string") types.push(type);
  }
  return types;
}

function referenceSymbolPopulation(reference: unknown): string[] {
  const symbols: string[] = [];
  for (const entry of referenceEntries(reference)) {
    symbols.push(...symbolPopulation((entry as { symbol?: unknown }).symbol));
  }
  return symbols;
}

function referenceFlag(reference: unknown, flag: "requireReview" | "noEvidenceExclude"): boolean {
  const entries = referenceEntries(reference);
  if (entries.length === 0) return false;
  return entries.every((entry) => (entry as Record<string, unknown>)[flag] === true);
}

/** The loaded `evidence/graph` rule must be the same object inventory validates. */
export function graphRuleFailures(rules: { readonly ["evidence/graph"]?: unknown } | undefined): string[] {
  const graphRule = rules?.["evidence/graph"];
  if (!Array.isArray(graphRule) || graphRule[0] !== "error" || graphRule[1] !== evidenceGraph) {
    return ["evidence/graph must load evidenceGraph at error severity"];
  }
  return [];
}

/** Requirement documents join the protected population next to their hosts. */
export function missingProtectedDocs(
  docs: readonly string[],
  protectedFiles: readonly string[],
): string[] {
  return docs.filter((doc) => !protectedFiles.includes(doc));
}

/** Each enabled evidence claim must keep its symbols, hosts, and reference review flags. */
export function enabledClaimFailures(
  claims: readonly {
    name?: string;
    disabled?: boolean;
    type?: unknown;
    symbol?: unknown;
    files?: readonly string[];
    reference?: unknown;
  }[] = evidenceGraph.claims,
): string[] {
  const failures: string[] = [];
  const enabled = claims.filter((claim) => !claim.disabled && claim.name !== undefined);
  for (const expected of enabledClaimHosts) {
    const matches = enabled.filter((claim) => claim.name === expected.name);
    if (matches.length !== 1) {
      fail(failures, `enabled claim ${expected.name} must appear once`);
      continue;
    }
    const claim = matches[0];
    if (claim?.type !== expected.type) {
      fail(failures, `enabled claim ${expected.name} type is not ${expected.type}`);
    }
    if (!claim || !samePopulation(symbolPopulation(claim.symbol), expected.symbols)) {
      fail(failures, `enabled claim ${expected.name} symbols are not its symbol population`);
    }
    if (!claim || !samePopulation(claim.files ?? [], expected.files)) {
      fail(failures, `enabled claim ${expected.name} files are not its host population`);
    }
    if (!claim || !samePopulation(referencePopulation(claim.reference), expected.references)) {
      fail(failures, `enabled claim ${expected.name} references are not its reference population`);
    }
    if (!claim || !samePopulation(referenceTypes(claim.reference), [expected.referenceType])) {
      fail(
        failures,
        `enabled claim ${expected.name} reference type is not ${expected.referenceType}`,
      );
    }
    if (
      !claim ||
      !samePopulation(referenceSymbolPopulation(claim.reference), expected.referenceSymbols)
    ) {
      fail(
        failures,
        `enabled claim ${expected.name} reference symbols are not its reference symbol population`,
      );
    }
    if (!claim || !referenceFlag(claim.reference, "requireReview")) {
      fail(failures, `enabled claim ${expected.name} reference requireReview is not true`);
    }
    if (!claim || !referenceFlag(claim.reference, "noEvidenceExclude")) {
      fail(failures, `enabled claim ${expected.name} reference noEvidenceExclude is not true`);
    }
  }
  return failures;
}
