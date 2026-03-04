import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import YAML from "yaml";

export async function readScenarioFile(path: string): Promise<unknown> {
  const abs = resolve(path);
  const raw = await readFile(abs, "utf8");
  const ext = extname(abs).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    return YAML.parse(raw);
  }

  return JSON.parse(raw);
}
