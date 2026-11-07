import { describe, expect, it } from "bun:test";
import type { ScenarioV1 } from "@idlekit/core";
import { assertDesignParameterPaths, parseDesignStudySpec, patchScenario } from "./designStudy";

const scenario = { model: { params: { recipes: [{ id: "smelter", timeSec: 2, build: { base: "10" } }], generators: [{ incomePerLevel: "3" }], costGrowth: 1.1, label: true } } } as unknown as ScenarioV1;
const spec = (path: string) => parseDesignStudySpec({ schemaVersion: 1, parameters: [{ path, min: 1, max: 2 }], objectives: [{ kind: "endNetWorthLog10" }] });

describe("design study array paths", () => {
  it("patches existing recipe/generator indexes without changing the source or numeric string types", () => {
    const values = { "model.params.recipes.0.timeSec": 1, "model.params.recipes.0.build.base": 12, "model.params.generators.0.incomePerLevel": 4, "model.params.costGrowth": 1.2 };
    for (const path of Object.keys(values)) expect(() => assertDesignParameterPaths(scenario, spec(path))).not.toThrow();
    const a = patchScenario(scenario, values);
    expect(a.model.params).toEqual({ recipes: [{ id: "smelter", timeSec: 1, build: { base: "12" } }], generators: [{ incomePerLevel: "4" }], costGrowth: 1.2, label: true });
    expect(a).toEqual(patchScenario(scenario, values));
    expect((scenario.model.params as any).recipes[0].timeSec).toBe(2);
    expect(patchScenario(scenario, { "model.params.newValue": 2 }).model.params).toHaveProperty("newValue", 2);
  });
  it("rejects nonnumeric string leaves before evaluation", () => {
    expect(() => assertDesignParameterPaths(scenario, spec("model.params.recipes.0.id"))).toThrow("numeric string");
    for (const value of ["smelter", "", "   ", "NaN", "Infinity", "+Infinity", "-Infinity", "10 COIN"]) {
      const input = { model: { params: { value } } } as unknown as ScenarioV1;
      expect(() => patchScenario(input, { "model.params.value": 4 })).toThrow("numeric string");
    }
  });
  it("preserves decimal, scientific, suffix and trailing-decimal numeric strings", () => {
    for (const value of ["10", "  +.5  ", "-2.5", "1.", "1.e2", "1.e400", "1e30", "1e400", "1aa", "1e-3aa", "0x10", "0b10", "0o10"]) {
      const input = { model: { params: { value } } } as unknown as ScenarioV1;
      expect(() => assertDesignParameterPaths(input, spec("model.params.value"))).not.toThrow();
      expect(patchScenario(input, { "model.params.value": 4 }).model.params).toEqual({ value: "4" });
      expect(input.model.params).toEqual({ value });
    }
  });
  it("uses the money parser for initial money fields while retaining native number syntax elsewhere", () => {
    for (const path of ["initial.wallet.amount", "initial.wallet.bucket", "initial.maxMoneyEver", "initial.prestige.points", "initial.prestige.multiplier"]) {
      for (const value of ["0x10", "0b10", "0o10", "1.", "1.e2"]) {
        const input = { initial: { wallet: { amount: value, bucket: value }, maxMoneyEver: value, prestige: { points: value, multiplier: value } } } as unknown as ScenarioV1;
        expect(() => assertDesignParameterPaths(input, spec(path))).toThrow("numeric string");
      }
      for (const value of ["10", "  +.5  ", "1e400", "1aa", "1e-3aa"]) {
        const input = { initial: { wallet: { amount: value, bucket: value }, maxMoneyEver: value, prestige: { points: value, multiplier: value } } } as unknown as ScenarioV1;
        expect(() => assertDesignParameterPaths(input, spec(path))).not.toThrow();
        expect(() => patchScenario(input, { [path]: 4 })).not.toThrow();
      }
    }
  });
  it("rejects missing or noncanonical indexes, array properties, non-number/string leaves and prototype traversal", () => {
    for (const path of ["model.params.recipes.1.timeSec", "model.params.recipes.01.timeSec", "model.params.recipes.-1.timeSec", "model.params.recipes.length", "model.params.recipes.foo.timeSec", "model.params.recipes.9007199254740992.timeSec", "model.params.recipes.0", "model.params.label", "model.params.recipes.0.__proto__.x", "model.constructor.x"]) {
      expect(() => patchScenario(scenario, { [path]: 1 })).toThrow();
    }
    expect(() => assertDesignParameterPaths(scenario, spec("model.params.recipes.2.timeSec"))).toThrow("existing array index");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
