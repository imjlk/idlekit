import { expect, test } from "bun:test";
import { planPacingRuns, runPacingChecks } from "./pacing";
import { renderBalanceReport } from "./report";

const config = (min: number | string, max?: number | string) => ({
  horizonSec: 1, seeds: [1], strategy: "fixture", targets: [{ metric: "money", unit: "MANA", min, ...(max === undefined ? {} : { max }) }],
});

test("decimal pacing compares huge amounts inclusively without overflow or epsilon ties", async () => {
  for (const [amount, min, max, status] of [
    ["1e400", "10e399", "1.0e400", "pass"],
    ["1.0000000000000001e400", "1e400", "1e400", "breach"],
    ["9.9999999999999999e399", "1e400", "2e400", "breach"],
    ["-2e400", "-3e400", "-1e400", "pass"],
    ["1e-400", 0, "2e-400", "pass"],
    ["-0.00e400", 0, 0, "pass"],
    [1, "0.9999999999999999", "1.0000000000000001", "pass"],
  ] as const) {
    const report = await runPacingChecks(config(min, max), () => ({ money: amount }));
    expect(report.status).toBe(status);
    expect(report.runs[0]?.results[0]?.value).toBe(amount);
    expect(JSON.stringify(report)).not.toContain('"value":null');
    const markdown = renderBalanceReport(report, "results");
    expect(markdown).toContain(String(amount));
    expect(markdown).not.toContain("Infinity");
    expect(markdown).not.toContain("NaN");
  }
});

test("decimal targets are ordered before execution and malformed decimals remain errors", async () => {
  expect(() => planPacingRuns(config("2e400", "1e400"))).toThrow("min exceeds max");
  for (const amount of ["", " ", " 1", "1 ", "0x10", "Infinity", "NaN", "1e", "1aa", "9".repeat(201)]) {
    expect(() => planPacingRuns(config(amount))).toThrow();
    const report = await runPacingChecks(config(0), () => ({ money: amount }));
    expect(report.status).toBe("error");
  }
  expect((await runPacingChecks(config("1e400"), () => ({ money: null }))).status).toBe("unreached");
  expect((await runPacingChecks(config("1e400"), () => ({ money: Infinity }))).status).toBe("error");
});
