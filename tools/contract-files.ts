import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  buildContractDocument,
  buildFieldMetadata,
  canonicalJson,
  sourceTextDigest,
  type SourceDigest,
} from "../packages/core/src/scenario/scenarioContract";

export const root = resolve(import.meta.dir, "..");
export const trackedDir = join(root, "docs/schemas/generated");
export const schemaName = "scenario.v1.schema.json";
export const fieldsName = "scenario.v1.fields.json";

const inputs = [
  "packages/core/src/scenario/offlinePolicy.ts",
  "packages/core/src/scenario/scenarioContract.ts",
  "packages/core/src/scenario/types.ts",
];

/** Digest each source with LF line endings, so a CRLF checkout matches the tracked contract. */
export function digestSources(paths: readonly string[], base = root): SourceDigest[] {
  return paths.map((path) => ({
    path,
    sha256: sourceTextDigest(readFileSync(join(base, path), "utf8")),
  }));
}

export function sourceDigests(base = root): SourceDigest[] {
  return digestSources(inputs, base);
}

export function renderedContracts(base = root): { schema: string; fields: string } {
  const sources = sourceDigests(base);
  return {
    schema: `${canonicalJson(buildContractDocument(sources))}\n`,
    fields: `${canonicalJson(buildFieldMetadata(sources))}\n`,
  };
}

export function writeContracts(dir: string, base = root): void {
  const rendered = renderedContracts(base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, schemaName), rendered.schema);
  writeFileSync(join(dir, fieldsName), rendered.fields);
}

export function compareContracts(dir: string, base = root): string[] {
  const rendered = renderedContracts(base);
  const failures: string[] = [];
  for (const [name, next] of [
    [schemaName, rendered.schema],
    [fieldsName, rendered.fields],
  ] as const) {
    const path = join(dir, name);
    let current = "";
    try {
      // A CRLF checkout of the tracked JSON is the same contract.
      current = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    } catch {
      failures.push(`missing ${name}`);
      continue;
    }
    if (current !== next) failures.push(`drift ${name}`);
  }
  return failures;
}
