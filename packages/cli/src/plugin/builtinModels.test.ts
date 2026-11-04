import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import { loadRegistries } from "./load";

const root = resolve(import.meta.dir, "../../../..");
const tutorials = {
  exponential: "26-exponential-forge-v1.json",
  prestige: "27-prestige-loop-v1.json",
  "multi-currency": "28-twin-currency-v1.json",
  "production-chain": "29-factory-chain-v1.json",
} as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("built-in models in the CLI", () => {
  it("registers linear and the four built-in models without a plugin", async () => {
    const loaded = await loadRegistries();
    for (const id of ["linear", ...Object.keys(tutorials)]) {
      expect(loaded.modelRegistry.get(id, 1)).toBeDefined();
    }
  });

  for (const [id, file] of Object.entries(tutorials)) {
    it(`${id}: the tutorial params satisfy docs/schemas/models/${id}.params.v1.schema.json`, () => {
      const schema = readJson(`docs/schemas/models/${id}.params.v1.schema.json`);
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      const validate = ajv.compile(schema);
      const scenario = readJson(`examples/tutorials/${file}`);
      const model = scenario.model as { id: string; params: unknown };
      expect(model.id).toBe(id);
      expect(validate(model.params)).toBe(true);
      expect(validate({ ...(model.params as object), ...(id === "prestige" ? { prestige: { requirement: -1 } } : { primary: 5, idleIncome: -1 }) })).toBe(false);
    });
  }
});
