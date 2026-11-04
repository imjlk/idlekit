import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { CLI_CWD, createTempDir, readText, removePath, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

describe("effectiveRunHash", () => {
  it("derives the same default seed for the default engine and --engine number", () => {
    const meta = (command: string[], extra: string[]) => runCliJson([...command, ...extra, "--format", "json"])._meta;
    const commands = [
      ["simulate", BASELINE, "--duration", "10"],
      ["experience", BASELINE, "--days", "1"],
      ["ltv", BASELINE, "--horizons", "30m"],
    ];
    for (const command of commands) {
      const plain = meta(command, []);
      const named = meta(command, ["--engine", "number"]);
      expect(named.seed).toBe(plain.seed);
      expect(named.effectiveRunHash).toBe(plain.effectiveRunHash);
    }
  }, 180000);

  it("derives the default seed from the strategy that runs", async () => {
    const meta = (command: string[], extra: string[]) => runCliJson([...command, ...extra, "--format", "json"])._meta;
    const commands = [
      ["simulate", BASELINE, "--duration", "10"],
      ["experience", BASELINE, "--days", "1"],
      ["ltv", BASELINE, "--horizons", "30m"],
    ];
    for (const command of commands) {
      const plain = meta(command, []);
      const same = meta(command, ["--strategy", "greedy"]);
      expect(same.seed).toBe(plain.seed);
      expect(same.runId).toBe(plain.runId);
      expect(same.effectiveRunHash).toBe(plain.effectiveRunHash);
      expect(meta(command, ["--strategy", "scripted"]).seed).not.toBe(plain.seed);
    }
    const compare = ["compare", BASELINE, BASELINE, "--duration", "10"];
    expect(meta(compare, ["--strategy", "greedy"]).seed).toBe(meta(compare, []).seed);

    // The scenario's greedy with its own params is not the greedy the flag runs on factory defaults.
    const dir = await createTempDir("idlekit-strategy-seed");
    try {
      const body = JSON.parse(await readText(resolve(CLI_CWD, BASELINE)));
      const tuned = resolve(dir, "tuned.json");
      const params = { schemaVersion: 1, objective: "minPayback", maxPicksPerStep: 2 };
      await writeText(tuned, JSON.stringify({ ...body, strategy: { id: "greedy", params } }));
      const simulate = ["simulate", tuned, "--duration", "10"];
      const own = meta(simulate, []);
      const reset = meta(simulate, ["--strategy", "greedy"]);
      expect(reset.effectiveRunHash).not.toBe(own.effectiveRunHash);
      expect(reset.seed).not.toBe(own.seed);
      expect(reset.runId).not.toBe(own.runId);
    } finally {
      await removePath(dir);
    }
  }, 180000);

  it("derives the default seed from the session and draws that run", async () => {
    const meta = (command: string[], extra: string[]) => runCliJson([...command, ...extra, "--format", "json"])._meta;
    const dir = await createTempDir("idlekit-session-seed");
    try {
      const body = JSON.parse(await readText(resolve(CLI_CWD, BASELINE)));
      const declared = resolve(dir, "declared.json");
      await writeText(
        declared,
        JSON.stringify({
          ...body,
          design: { sessionPattern: { id: "short-bursts", days: 1 } },
          analysis: { ...body.analysis, experience: { draws: 2 } },
          monetization: { uncertainty: { enabled: true, draws: 3 } },
        }),
      );
      const experience = ["experience", declared];
      const plain = meta(experience, []);
      for (const extra of [["--session-pattern", "short-bursts"], ["--days", "1"], ["--draws", "2"]]) {
        const same = meta(experience, extra);
        expect(same.seed).toBe(plain.seed);
        expect(same.effectiveRunHash).toBe(plain.effectiveRunHash);
      }
      for (const extra of [["--session-pattern", "twice-daily"], ["--days", "2"], ["--draws", "3"]]) {
        const other = meta(experience, extra);
        expect(other.seed).not.toBe(plain.seed);
        expect(other.effectiveRunHash).not.toBe(plain.effectiveRunHash);
      }

      const ltv = ["ltv", declared, "--horizons", "30m"];
      const ltvPlain = meta(ltv, []);
      const ltvSame = meta(ltv, ["--draws", "3"]);
      expect(ltvSame.seed).toBe(ltvPlain.seed);
      expect(ltvSame.effectiveRunHash).toBe(ltvPlain.effectiveRunHash);
      const ltvOther = meta(ltv, ["--draws", "4"]);
      expect(ltvOther.seed).not.toBe(ltvPlain.seed);
      expect(ltvOther.effectiveRunHash).not.toBe(ltvPlain.effectiveRunHash);
    } finally {
      await removePath(dir);
    }
  }, 180000);

  it("derives the default seed from the fast mode that runs", async () => {
    const meta = (command: string[], extra: string[]) => runCliJson([...command, ...extra, "--format", "json"])._meta;
    const dir = await createTempDir("idlekit-fast-seed");
    try {
      const body = JSON.parse(await readText(resolve(CLI_CWD, BASELINE)));
      const fast = resolve(dir, "fast.json");
      await writeText(fast, JSON.stringify({ ...body, sim: { fast: true } }));
      for (const command of [
        ["simulate", fast, "--duration", "10"],
        ["ltv", fast, "--horizons", "30m"],
      ]) {
        const plain = meta(command, []);
        for (const extra of [["--fast", "true"], ["--fast"]]) {
          const same = meta(command, extra);
          expect(same.seed).toBe(plain.seed);
          expect(same.effectiveRunHash).toBe(plain.effectiveRunHash);
        }
        const disabled = meta(command, ["--fast", "false"]);
        expect(disabled.seed).not.toBe(plain.seed);
        expect(disabled.effectiveRunHash).not.toBe(plain.effectiveRunHash);
        for (const extra of [["--no-fast"], ["--fast=false"]]) {
          const same = meta(command, extra);
          expect(same.seed).toBe(disabled.seed);
          expect(same.effectiveRunHash).toBe(disabled.effectiveRunHash);
        }
      }
      for (const command of [
        ["simulate", BASELINE, "--duration", "10"],
        ["ltv", BASELINE, "--horizons", "30m"],
      ]) {
        const plain = meta(command, []);
        expect(meta(command, ["--fast", "false"]).seed).toBe(plain.seed);
        expect(meta(command, ["--fast", "true"]).seed).not.toBe(plain.seed);
      }
      const compare = ["compare", fast, fast, "--duration", "10"];
      const inherited = meta(compare, []);
      expect(meta(compare, ["--fast", "true"]).seed).toBe(inherited.seed);
      const disabled = meta(compare, ["--fast", "false"]);
      expect(disabled.seed).not.toBe(inherited.seed);
      expect(disabled.runId).not.toBe(inherited.runId);
      expect(meta(compare, ["--no-fast"]).seed).toBe(disabled.seed);
    } finally {
      await removePath(dir);
    }
  }, 180000);
});
