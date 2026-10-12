import { describe, expect, it } from "bun:test";
import {
  analysisCanonicalJson,
  validateAnalysisSemantics,
  type MetricReadingV1,
} from "./contracts";
import { buildAnalysisArtifact } from "./metrics";
import { createModelAnalysisRegistry } from "./registry";

function amount(decimal: string): MetricReadingV1 {
  return {
    metricId: "money", metricVersion: 1, meaning: "Wallet amount",
    metricKind: "stock", timeAxis: "instant", domain: "amount",
    reading: "observed", status: "ok", sign: "positive",
    amount: { unit: "COIN", decimal },
  };
}

function numeric(value: number, sign: MetricReadingV1["sign"]): MetricReadingV1 {
  return { ...amount("1"), domain: "count", amount: undefined, value, sign };
}

describe("analysis contract validity", () => {
  it("rejects nonfinite engine amount strings without narrowing large finite amounts", () => {
    for (const decimal of ["NaN", "+NaN", "Infinity", "+Infinity", "-Infinity", " infinity "]) {
      expect(validateAnalysisSemantics(buildAnalysisArtifact({ metrics: [amount(decimal)] })).length).toBeGreaterThan(0);
    }
    for (const decimal of ["1e400", "1e-400", "1e9000000000000000"]) {
      expect(validateAnalysisSemantics(buildAnalysisArtifact({ metrics: [amount(decimal)] }))).toEqual([]);
    }
  });

  it("rejects numeric signs that contradict finite values", () => {
    for (const [value, sign] of [[-1, "positive"], [0, "negative"], [1, "zero"], [1, "nonfinite"]] as const) {
      expect(validateAnalysisSemantics(buildAnalysisArtifact({ metrics: [numeric(value, sign)] })).length).toBeGreaterThan(0);
    }
  });

  it("accepts matching and omitted numeric signs, including negative zero", () => {
    for (const [value, sign] of [[-1, "negative"], [0, "zero"], [-0, "zero"], [1, "positive"], [-1, undefined]] as const) {
      expect(validateAnalysisSemantics(buildAnalysisArtifact({ metrics: [numeric(value, sign)] }))).toEqual([]);
    }
  });

  it("preserves single and multiple sparse array slots as JSON null", () => {
    expect(analysisCanonicalJson(new Array(1))).toBe("[null]");
    expect(analysisCanonicalJson(new Array(2))).toBe("[null,null]");
    expect(JSON.parse(analysisCanonicalJson(new Array(2)))).toEqual([null, null]);
  });

  it("preserves holes around nested values and keeps object keys canonical", () => {
    const values = new Array(4);
    values[1] = { z: undefined, b: 2, a: 1 };
    values[3] = undefined;
    expect(analysisCanonicalJson({ values })).toBe('{"values":[null,{"a":1,"b":2},null,null]}');
    expect(JSON.parse(analysisCanonicalJson({ values }))).toEqual({ values: [null, { a: 1, b: 2 }, null, null] });
  });

  it("serializes array indices even when the array has a custom iterator", () => {
    const values = [1, 2];
    values[Symbol.iterator] = function* () { yield 9; };
    expect(analysisCanonicalJson(values)).toBe(JSON.stringify(values));
  });

  it("distinguishes no registered adapter from a registered adapter with no capabilities", () => {
    const registry = createModelAnalysisRegistry<number, "COIN", {}>();
    registry.register({ modelId: "plain", modelVersion: 1 });
    for (const name of ["metrics", "goals", "flow", "reset", "advance"] as const) {
      expect(registry.knowledge("plain", 1, name)).toBe("unsupported");
      expect(registry.knowledge("plain", 2, name)).toBe("unknown");
      expect(registry.knowledge("missing", 1, name)).toBe("unknown");
    }
  });

  it("preserves explicit capability declarations", () => {
    const registry = createModelAnalysisRegistry<number, "COIN", {}>();
    registry.register({ modelId: "partial", modelVersion: 1, capabilities: { metrics: "statically-known", flow: "unsupported" } });
    expect(registry.knowledge("partial", 1, "metrics")).toBe("statically-known");
    expect(registry.knowledge("partial", 1, "flow")).toBe("unsupported");
    expect(registry.knowledge("partial", 1, "reset")).toBe("unsupported");
  });
});

