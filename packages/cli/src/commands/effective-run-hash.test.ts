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

  it("hashes the resume state the run reads, not its save metadata", async () => {
    const dir = await createTempDir("idlekit-resume-hash");
    try {
      const saved = resolve(dir, "saved.json");
      runCliJson(["simulate", BASELINE, "--duration", "10", "--state-out", saved, "--format", "json"]);
      const state = await readJson<any>(saved);
      expect(state.meta?.savedAt).toBeString();
      const write = async (name: string, body: any) => {
        const path = resolve(dir, name);
        await writeText(path, `${JSON.stringify(body, null, 2)}\n`);
        return path;
      };
      const moved = await write("moved.json", {
        ...state,
        meta: { ...state.meta, scenarioPath: "/elsewhere/s.json", savedAt: "2000-01-01T00:00:00.000Z", runId: "other", gitSha: "abc" },
      });
      const richer = await write("richer.json", { ...state, wallet: { ...state.wallet, amount: "1000000" } });
      const resume = (path: string, extra: string[]) =>
        runCliJson(["simulate", BASELINE, "--resume", path, "--duration", "20", "--format", "json", ...extra])._meta;

      for (const extra of [["--seed", "1"], []]) {
        const base = resume(saved, extra);
        const same = resume(moved, extra);
        expect(same.seed).toBe(base.seed);
        expect(same.effectiveRunHash).toBe(base.effectiveRunHash);
        expect(resume(richer, extra).effectiveRunHash).not.toBe(base.effectiveRunHash);
      }
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

  it("keeps the default evaluate seed off stage-only flags", async () => {
    const dir = await createTempDir("idlekit-evaluate-seed");
    try {
      let n = 0;
      const evaluate = async (extra: string[]) => {
        const outDir = resolve(dir, `out${n++}`);
        runCli(["evaluate", BASELINE, "--horizons", "30m", "--days", "1", "--out-dir", outDir, ...extra]);
        const read = (name: string) => readJson<any>(resolve(outDir, name));
        return {
          simulate: (await read("simulate.json"))._meta,
          experience: await read("experience.json"),
          ltv: (await read("ltv.json"))._meta,
        };
      };
      const body = ({ _meta, ...rest }: any) => rest;
      const base = await evaluate([]);
      const stepped = await evaluate(["--step", "2", "--fast", "true"]);
      expect(stepped.experience._meta.seed).toBe(base.experience._meta.seed);
      expect(stepped.experience._meta.effectiveRunHash).toBe(base.experience._meta.effectiveRunHash);
      expect(body(stepped.experience)).toEqual(body(base.experience));
      expect(stepped.simulate.effectiveRunHash).not.toBe(base.simulate.effectiveRunHash);

      const days = await evaluate(["--days", "2"]);
      expect(days.simulate.seed).toBe(base.simulate.seed);
      expect(days.simulate.effectiveRunHash).toBe(base.simulate.effectiveRunHash);
      expect(days.ltv.effectiveRunHash).toBe(base.ltv.effectiveRunHash);

      const consistent = await evaluate(["--step", "2", "--fast", "true", "--consistent-overrides", "true"]);
      expect(consistent.simulate.effectiveRunHash).toBe(stepped.simulate.effectiveRunHash);
      expect(consistent.experience._meta.effectiveRunHash).not.toBe(stepped.experience._meta.effectiveRunHash);

      const named = await evaluate(["--engine", "number"]);
      expect(named.simulate.seed).toBe(base.simulate.seed);
      expect(named.experience._meta.effectiveRunHash).toBe(base.experience._meta.effectiveRunHash);

      const greedy = await evaluate(["--strategy", "greedy"]);
      expect(greedy.simulate.seed).toBe(base.simulate.seed);
      expect(greedy.simulate.effectiveRunHash).toBe(base.simulate.effectiveRunHash);
      expect(greedy.experience._meta.effectiveRunHash).toBe(base.experience._meta.effectiveRunHash);
      expect((await evaluate(["--strategy", "scripted"])).simulate.seed).not.toBe(base.simulate.seed);

      const seeded = await evaluate(["--step", "2", "--seed", "7"]);
      expect([seeded.simulate.seed, seeded.experience._meta.seed, seeded.ltv.seed]).toEqual([7, 7, 7]);
    } finally {
      await removePath(dir);
    }
  }, 180000);
});
