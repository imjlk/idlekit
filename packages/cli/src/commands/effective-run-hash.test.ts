import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, removePath, runCli, runCliJson } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

function hashOf(args: string[]): string {
  const out = runCliJson([...args, "--seed", "1", "--format", "json"]);
  expect(typeof out._meta?.effectiveRunHash).toBe("string");
  return out._meta.effectiveRunHash;
}

describe("effectiveRunHash", () => {
  it("changes with simulate and ltv inputs that change the result", () => {
    const sim = hashOf(["simulate", BASELINE, "--duration", "10"]);
    expect(hashOf(["simulate", BASELINE, "--duration", "10"])).toBe(sim);
    expect(hashOf(["simulate", BASELINE, "--duration", "20"])).not.toBe(sim);
    expect(hashOf(["simulate", BASELINE, "--duration", "10", "--offline-seconds", "60"])).not.toBe(sim);

    const ltv = hashOf(["ltv", BASELINE, "--horizons", "30m"]);
    expect(hashOf(["ltv", BASELINE, "--horizons", "30m"])).toBe(ltv);
    expect(hashOf(["ltv", BASELINE, "--horizons", "2h"])).not.toBe(ltv);
    expect(hashOf(["ltv", BASELINE, "--horizons", "30m", "--draws", "3"])).not.toBe(ltv);
    expect(hashOf(["ltv", BASELINE, "--horizons", "30m", "--value-per-worth", "2"])).not.toBe(ltv);
  });

  it("gives evaluate stages their own digest", async () => {
    const dir = await createTempDir("idlekit-evaluate-hash");
    try {
      const evaluate = async (outDir: string, extra: string[]) => {
        runCli(["evaluate", BASELINE, "--horizons", "30m", "--step", "2", "--seed", "1", "--out-dir", outDir, ...extra]);
        const read = (name: string) => readJson<any>(resolve(outDir, name)).then((x) => x._meta);
        return {
          simulate: await read("simulate.json"),
          experience: await read("experience.json"),
          ltv: await read("ltv.json"),
          summary: await read("summary.json"),
        };
      };
      const split = await evaluate(resolve(dir, "split"), []);
      const consistent = await evaluate(resolve(dir, "consistent"), ["--consistent-overrides", "true"]);

      expect(new Set([split.simulate, split.experience, split.ltv].map((m) => m.effectiveRunHash)).size).toBe(3);
      expect(split.experience.stageScope.experience.step).toBeFalse();
      expect(consistent.experience.stageScope.experience.step).toBeTrue();
      expect(consistent.simulate.effectiveRunHash).toBe(split.simulate.effectiveRunHash);
      expect(consistent.experience.effectiveRunHash).not.toBe(split.experience.effectiveRunHash);
      expect(consistent.summary.effectiveRunHash).not.toBe(split.summary.effectiveRunHash);
    } finally {
      await removePath(dir);
    }
  });
});
