import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { BENCH_END_MONEY_PATH, endMoneyCheck, readBenchEndMoney } from "./bench-sim";

describe("bench-sim end money", () => {
  it("fails a fast wrong total and an unrecorded scenario", () => {
    const recorded = readBenchEndMoney(JSON.parse(readFileSync(resolve(import.meta.dir, "..", BENCH_END_MONEY_PATH), "utf8")));
    const expected = recorded["examples/bench/representative.json"];
    expect(expected).toBeDefined();
    expect(endMoneyCheck(expected, [expected, expected])).toBe("match");
    expect(endMoneyCheck(expected, [expected, "0"])).toBe("mismatch");
    expect(endMoneyCheck(expected, [Number(expected)])).toBe("mismatch");
    expect(endMoneyCheck(expected, [])).toBe("mismatch");
    expect(endMoneyCheck(undefined, [expected])).toBe("unrecorded");
    expect(() => readBenchEndMoney({ endMoney: { a: 1 } })).toThrow("is not a string");
    expect(() => readBenchEndMoney({})).toThrow("no endMoney map");
  });

  it("records every scenario the bench scripts run", () => {
    const recorded = readBenchEndMoney(JSON.parse(readFileSync(resolve(import.meta.dir, "..", BENCH_END_MONEY_PATH), "utf8")));
    const scripts = (JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }).scripts;
    const named = Object.entries(scripts)
      .filter(([name]) => name.startsWith("bench:sim"))
      .flatMap(([, command]) => [...command.matchAll(/examples\/bench\/[\w.-]+\.json/g)].map((match) => match[0]));
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) expect(recorded[path]).toBeDefined();
  });
});
