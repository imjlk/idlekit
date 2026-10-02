export type InventoryTest = {
  file: string;
  exportName: string;
  registeredAs: string;
  cwd: string;
  args: string[];
};

type InventoryRequirement = {
  id: string;
  pr: string;
  anchor: string;
  doc: string;
  production: string[];
  tests: InventoryTest[];
};

export type InventoryFile = {
  requirements: InventoryRequirement[];
};

export type BaselineFile = {
  ids: string[];
  protectedFiles: string[];
};

export type ShrinkResult = {
  ok: boolean;
  missing: string[];
};

const SOURCE_EXTENSION = /\.(?:[cm]?tsx?)$/;
const NON_PRODUCTION_ROLE = /\.(?:test|spec|generated|d)$/;
const NON_PRODUCTION_SEGMENTS = new Set(["fixtures", "dist", "__tests__", "test", "tests"]);

export function isNonProductionPath(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/");
  const file = normalized.split("/").at(-1) ?? normalized;
  const stem = file.replace(SOURCE_EXTENSION, "");
  if (stem !== file && NON_PRODUCTION_ROLE.test(stem)) return true;
  return normalized.split("/").some((segment) => NON_PRODUCTION_SEGMENTS.has(segment));
}

/** Package sources the inventory must keep, including `.tsx`, `.mts`, and `.cts`. */
export function isInventoryPackageHost(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/");
  return normalized.startsWith("packages/") && SOURCE_EXTENSION.test(normalized);
}

export function hasProductionExport(body: string): boolean {
  return /\bexport\s+(?:default\s+)?(?:async\s+)?function\b/.test(body)
    || /\bexport\s+(?:const|class|type|interface|enum)\b/.test(body)
    || /\bexport\s*\{/.test(body);
}
