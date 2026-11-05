import { describe, expect, it } from "bun:test";
import type { ScenarioV1 } from "@idlekit/core";
import { emitGodotTres, emitUnityCsv, supportedFileFormats } from "./emitters";
import { ENGINE_PARAMS_FORMAT, formatEngineNumber, isEngineParamsDocument, type EngineParamsV1 } from "./engineParams";
import { withinTolerance } from "./runtimeVerify";
import {
  DEFAULT_SUFFIXES,
  fitGeometric,
  fitLinear,
  importMappingSchema,
  importScenarioFromEngineParams,
  importScenarioWithMapping,
  parseCsv,
  parseQuantity,
} from "./scenarioImport";

function doc(overrides: Partial<EngineParamsV1> = {}): EngineParamsV1 {
  return {
    format: ENGINE_PARAMS_FORMAT,
    formatVersion: 1,
    source: { scenarioId: 'quote"d', title: "line\nbreak", scenarioHash: "0".repeat(64), cliVersion: "0.0.0" },
    unit: { code: "COIN" },
    model: { id: "plugin.generators", version: 2 },
    clock: { stepSec: 1 },
    policy: { mode: "drop" },
    initial: { t: 0, wallet: "5", vars: { producers: 1, nested: { a: 1 } }, prestige: { count: 0, points: "0", multiplier: "1" } },
    parameters: [
      { key: "baseIncome", type: "amount", value: "2" },
      { key: "upgrade.growth", type: "number", value: 1.5 },
      { key: "enabled", type: "boolean", value: true },
    ],
    curves: [],
    notes: [],
    ...overrides,
  } as EngineParamsV1;
}

describe("engine params helpers", () => {
  it("formats numbers compactly and recognises documents", () => {
    expect(formatEngineNumber(13.320000000000002)).toBe("13.32");
    expect(formatEngineNumber(1e21)).toBe("1e+21");
    expect(formatEngineNumber(0)).toBe("0");
    expect(isEngineParamsDocument(doc())).toBe(true);
    expect(isEngineParamsDocument({ format: "other" })).toBe(false);
  });

  it("escapes Godot strings and writes empty tables for models without levels", () => {
    const tres = emitGodotTres(doc());
    expect(tres).toContain('scenario_id = "quote\\"d"');
    expect(tres).toContain('title = "line\\nbreak"');
    expect(tres).toContain("cost_table = PackedFloat64Array()");
    expect(tres).toContain('"upgrade.growth": 1.5');
    expect(tres).toContain('"enabled": true');
    expect(tres).toContain("duration_sec = 0.0");
  });

  it("falls back to the parameter CSV when there is no level table", () => {
    expect(emitUnityCsv(doc())).toBe("key,type,role,value\nbaseIncome,amount,other,2\nupgrade.growth,number,other,1.5\nenabled,boolean,other,true\n");
    expect(() => emitUnityCsv(doc(), "levels")).toThrow("no level table");
    expect(supportedFileFormats("godot")).toEqual(["tres", "json"]);
  });

  it("restores dotted plugin parameters on import", () => {
    const { scenario } = importScenarioFromEngineParams(doc(), { id: "renamed" });
    expect(scenario.meta?.id).toBe("renamed");
    expect(scenario.model).toEqual({
      id: "plugin.generators",
      version: 2,
      params: { baseIncome: "2", upgrade: { growth: 1.5 }, enabled: true },
    } as ScenarioV1["model"]);
    expect(scenario.initial.wallet.amount).toBe("5");
  });
});

describe("table parsing", () => {
  it("parses RFC 4180 CSV with BOM, quotes, and blank lines", () => {
    const rows = parseCsv('\ufeffname,price,note\r\n"Big, shop","1,200","say ""hi"""\r\n\r\nsmall,3,"two\nlines"\n');
    expect(rows).toEqual([
      { name: "Big, shop", price: "1,200", note: 'say "hi"' },
      { name: "small", price: "3", note: "two\nlines" },
    ]);
  });

  it("reads separators, suffixes, and exact decimals", () => {
    expect(parseQuantity("1,500", DEFAULT_SUFFIXES, "x")).toEqual({ exact: "1500", value: 1500 });
    expect(parseQuantity("2.5K", DEFAULT_SUFFIXES, "x").value).toBe(2500);
    expect(parseQuantity("3m", DEFAULT_SUFFIXES, "x").value).toBe(3e6);
    expect(parseQuantity("1e400", DEFAULT_SUFFIXES, "x").exact).toBe("1e400");
    expect(parseQuantity(7, DEFAULT_SUFFIXES, "x")).toEqual({ value: 7 });
    expect(() => parseQuantity("4Qa", DEFAULT_SUFFIXES, "x")).toThrow("unknown unit suffix 'Qa'");
    expect(parseQuantity("4Qa", { ...DEFAULT_SUFFIXES, Qa: 1e15 }, "x").value).toBe(4e15);
    expect(() => parseQuantity("abc", DEFAULT_SUFFIXES, "x")).toThrow("is not a number");
  });
});

describe("curve fits", () => {
  it("recovers an exact geometric curve", () => {
    const levels = [0, 1, 2, 3, 4];
    const fit = fitGeometric(levels, levels.map((n) => 10 * 1.2 ** n));
    expect(Number(fit.base)).toBeCloseTo(10, 9);
    expect(fit.growth).toBeCloseTo(1.2, 9);
    expect(fit.r2).toBeCloseTo(1, 9);
    expect(fit.maxRelError).toBeLessThan(1e-9);
  });

  it("recovers an exact line", () => {
    const fit = fitLinear([0, 2, 4], [1, 2, 3]);
    expect(fit.base).toBe("1");
    expect(fit.perUnit).toBe("0.5");
    expect(fit.maxRelError).toBe(0);
  });

  it("warns when a cost table is not geometric", () => {
    const mapping = importMappingSchema.parse({
      format: "idlekit.import-mapping",
      formatVersion: 1,
      scenario: { id: "steps", unit: { code: "COIN" }, clock: { stepSec: 1 } },
      curves: { level: "lv", cost: "cost" },
    });
    const table = [
      { lv: 0, cost: 10 },
      { lv: 1, cost: 10 },
      { lv: 2, cost: 40 },
      { lv: 3, cost: 40 },
    ];
    const { report } = importScenarioWithMapping(table, mapping);
    expect(report.warnings.some((w) => w.includes("deviates"))).toBe(true);
  });
});

describe("runtime tolerance", () => {
  it("accepts either an absolute or a relative match", () => {
    expect(withinTolerance(1, 1, { relative: 0, absolute: 0 }).ok).toBe(true);
    expect(withinTolerance(100, 100.5, { relative: 0.01, absolute: 0 }).ok).toBe(true);
    expect(withinTolerance(13.32, 14, { relative: 1e-9, absolute: 1 }).ok).toBe(true);
    expect(withinTolerance(13.32, 14, { relative: 1e-9, absolute: 0 }).ok).toBe(false);
    expect(withinTolerance(0, 0, { relative: 0, absolute: 0 }).rel).toBe(0);
  });
});
