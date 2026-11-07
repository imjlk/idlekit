import { describe, expect, it } from "bun:test";
import type { ScenarioV1 } from "@idlekit/core";
import { assertDesignParameterPaths, parseDesignStudySpec, patchScenario } from "./designStudy";

const scenario = { model: { params: { recipes: [{ timeSec: 2, build: { base: "10" } }], generators: [{ incomePerLevel: "3" }], costGrowth: 1.1, label: true } } } as unknown as ScenarioV1;
const spec = (path: string) => parseDesignStudySpec({ schemaVersion: 1, parameters: [{ path, min: 1, max: 2 }], objectives: [{ kind: "endNetWorthLog10" }] });

describe("design study array paths", () => {
  it("patches existing recipe/generator indexes without changing the source or numeric string types", () => {
    const values = { "model.params.recipes.0.timeSec": 1, "model.params.recipes.0.build.base": 12, "model.params.generators.0.incomePerLevel": 4, "model.params.costGrowth": 1.2 };
    for (const path of Object.keys(values)) expect(() => assertDesignParameterPaths(scenario, spec(path))).not.toThrow();
    const a = patchScenario(scenario, values);
    expect(a.model.params).toEqual({ recipes: [{ timeSec: 1, build: { base: "12" } }], generators: [{ incomePerLevel: "4" }], costGrowth: 1.2, label: true });
    expect(a).toEqual(patchScenario(scenario, values));
    expect((scenario.model.params as any).recipes[0].timeSec).toBe(2);
    expect(patchScenario(scenario, { "model.params.newValue": 2 }).model.params).toHaveProperty("newValue", 2);
  });
  it("rejects missing or noncanonical indexes, array properties, non-number/string leaves and prototype traversal", () => {
    for (const path of ["model.params.recipes.1.timeSec", "model.params.recipes.01.timeSec", "model.params.recipes.-1.timeSec", "model.params.recipes.length", "model.params.recipes.foo.timeSec", "model.params.recipes.9007199254740992.timeSec", "model.params.recipes.0", "model.params.label", "model.params.recipes.0.__proto__.x", "model.constructor.x"]) {
      expect(() => patchScenario(scenario, { [path]: 1 })).toThrow();
    }
    expect(() => assertDesignParameterPaths(scenario, spec("model.params.recipes.2.timeSec"))).toThrow("existing array index");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
