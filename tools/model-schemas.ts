/**
 * Writes or checks docs/schemas/models/<id>.params.v1.schema.json from the built-in model zod schemas.
 * `bun tools/model-schemas.ts` checks; `--write` regenerates. The core unit test runs the same comparison.
 */
import { resolve } from "path";
import { builtinModelParamsJsonSchemas } from "../packages/core/src/models/index";

const dir = resolve(import.meta.dir, "../docs/schemas/models");
const write = process.argv.includes("--write");
let drift = 0;
for (const [id, schema] of Object.entries(builtinModelParamsJsonSchemas())) {
  const path = resolve(dir, `${id}.params.v1.schema.json`);
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  if (write) {
    await Bun.write(path, text);
    continue;
  }
  const file = Bun.file(path);
  const current = (await file.exists()) ? (await file.text()).replace(/\r\n/g, "\n") : "";
  if (current !== text) {
    drift += 1;
    console.error(`drift: ${path}`);
  }
}
if (drift > 0) {
  console.error("run: bun tools/model-schemas.ts --write");
  process.exit(1);
}
console.log(write ? "model params schemas written" : "model params schemas match");
