import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { migrateScenarioDocument, type ScenarioMigrationNotice } from "@idlekit/core";
import YAML from "yaml";
import { scenarioReadFailedError } from "../errors";

export async function readScenarioFile(path: string): Promise<unknown> {
  const out = await readScenarioFileWithMeta(path);
  return out.value;
}

export async function readScenarioFileWithMeta(path: string): Promise<{
  value: unknown;
  notices: ScenarioMigrationNotice[];
}> {
  const abs = resolve(path);
  const raw = await readFile(abs, "utf8").catch((error) => {
    throw scenarioReadFailedError(abs, error);
  });
  const ext = extname(abs).toLowerCase();

  const parsed = (() => {
    try {
      return ext === ".yaml" || ext === ".yml" ? YAML.parse(raw) : JSON.parse(raw);
    } catch (error) {
      throw scenarioReadFailedError(abs, error);
    }
  })();
  const migrated = migrateScenarioDocument(parsed);

  return {
    value: migrated.document,
    notices: migrated.notices,
  };
}
