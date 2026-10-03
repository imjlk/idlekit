import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { CLI_CWD, createTempDir, readJson, readText, removePath, runCli, runCliJson, writeText } from "../testkit/bun";

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

  it("matches a copied scenario in another directory without --seed", async () => {
    const dir = await createTempDir("idlekit-default-seed");
    try {
      const body = await readText(resolve(CLI_CWD, BASELINE));
      const copies = [resolve(dir, "one", "s.json"), resolve(dir, "two", "s.json")];
      for (const path of copies) await writeText(path, body);
      const simulate = copies.map((path) =>
        runCliJson(["simulate", path, "--duration", "10", "--format", "json"])._meta,
      );
      expect(simulate[1].seed).toBe(simulate[0].seed);
      expect(simulate[1].effectiveRunHash).toBe(simulate[0].effectiveRunHash);

      const evaluate = [];
      for (const [i, path] of copies.entries()) {
        const outDir = resolve(dir, `out${i}`);
        runCli(["evaluate", path, "--horizons", "30m", "--out-dir", outDir]);
        evaluate.push(await readJson<any>(resolve(outDir, "summary.json")).then((x) => x._meta));
      }
      expect(evaluate[1].seed).toBe(evaluate[0].seed);
      expect(evaluate[1].effectiveRunHash).toBe(evaluate[0].effectiveRunHash);
    } finally {
      await removePath(dir);
    }
  });

  it("records the experience scope from its opened plan", () => {
    const out = runCliJson(["experience", BASELINE, "--days", "1", "--seed", "1", "--format", "json"]);
    expect(out._meta.stageScope).toEqual({ experience: { strategy: true, step: false, fast: false, session: true } });
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
