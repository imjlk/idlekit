import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { migrateScenarioDocument, type ScenarioMigrationNotice } from "@idlekit/core";
import YAML from "yaml";

export async function readScenarioFile(path: string): Promise<unknown> {
  const out = await readScenarioFileWithMeta(path);
  return out.value;
}

export async function readScenarioFileWithMeta(path: string): Promise<{
  value: unknown;
  notices: ScenarioMigrationNotice[];
}> {
  const abs = resolve(path);
  const raw = await readFile(abs, "utf8");
  const ext = extname(abs).toLowerCase();

  const parsed = ext === ".yaml" || ext === ".yml" ? YAML.parse(raw) : JSON.parse(raw);
  const migrated = migrateScenarioDocument(parsed);

  return {
    value: migrated.document,
    notices: migrated.notices,
  };
}
