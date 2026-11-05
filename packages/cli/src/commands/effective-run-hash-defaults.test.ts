import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { CLI_CWD, createTempDir, readText, removePath, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

function hashOf(args: string[]): string {
  const out = runCliJson([...args, "--seed", "1", "--format", "json"]);
  expect(typeof out._meta?.effectiveRunHash).toBe("string");
  return out._meta.effectiveRunHash;
}

describe("effectiveRunHash", () => {
  it("hashes the session pattern defaults experience runs", () => {
    const meta = (extra: string[]) => runCliJson(["experience", BASELINE, ...extra, "--format", "json"])._meta;
    // Without a declared pattern, experience runs always-on for 7 days.
    const plain = meta([]);
    const resolved = meta(["--session-pattern", "always-on", "--days", "7"]);
    expect(resolved.seed).toBe(plain.seed);
    expect(resolved.effectiveRunHash).toBe(plain.effectiveRunHash);
    expect(meta(["--seed", String(plain.seed), "--days", "6"]).effectiveRunHash).not.toBe(plain.effectiveRunHash);
  }, 180000);

  it("hashes the event log the simulate run keeps, not the flags", async () => {
    const dir = await createTempDir("idlekit-event-log-hash");
    try {
      const sim = (path: string, extra: string[]) => hashOf(["simulate", path, "--duration", "10", ...extra]);
      const plain = sim(BASELINE, []);
      expect(sim(BASELINE, ["--event-log-enabled", "true"])).toBe(plain);
      expect(sim(BASELINE, ["--event-log-max", "5"])).not.toBe(plain);

      const body = JSON.parse(await readText(resolve(CLI_CWD, BASELINE)));
      const capped = resolve(dir, "capped.json");
      await writeText(capped, JSON.stringify({ ...body, sim: { ...body.sim, eventLog: { maxEvents: 5 } } }));
      const scenario = sim(capped, []);
      expect(sim(capped, ["--event-log-max", "5"])).toBe(scenario);
      expect(sim(capped, ["--event-log-enabled", "true", "--event-log-max", "5"])).toBe(scenario);
      expect(sim(capped, ["--event-log-max", "6"])).not.toBe(scenario);
      expect(sim(capped, ["--event-log-enabled", "false"])).not.toBe(scenario);
    } finally {
      await removePath(dir);
    }
  }, 180000);
});
