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
      // The run id reads the stage digest, not the path, with or without --seed.
      for (const command of [
        (path: string) => ["simulate", path, "--duration", "10"],
        (path: string) => ["simulate", path, "--duration", "10", "--seed", "1"],
        (path: string) => ["experience", path, "--days", "1"],
        (path: string) => ["ltv", path, "--horizons", "30m"],
        (path: string) => ["compare", path, BASELINE, "--duration", "10"],
      ]) {
        const metas = copies.map((path) => runCliJson([...command(path), "--format", "json"])._meta);
        expect(metas[1].seed).toBe(metas[0].seed);
        expect(metas[1].runId).toBe(metas[0].runId);
        expect(metas[1].effectiveRunHash).toBe(metas[0].effectiveRunHash);
      }
      const relative = runCliJson(["experience", BASELINE, "--days", "1", "--format", "json"])._meta;
      const absolute = runCliJson(["experience", resolve(CLI_CWD, BASELINE), "--days", "1", "--format", "json"])._meta;
      expect(absolute.runId).toBe(relative.runId);

      const evaluate = [];
      for (const [i, path] of copies.entries()) {
        const outDir = resolve(dir, `out${i}`);
        runCli(["evaluate", path, "--horizons", "30m", "--out-dir", outDir]);
        evaluate.push(await readJson<any>(resolve(outDir, "summary.json")).then((x) => x._meta));
      }
      expect(evaluate[1].seed).toBe(evaluate[0].seed);
      expect(evaluate[1].runId).toBe(evaluate[0].runId);
      expect(evaluate[1].effectiveRunHash).toBe(evaluate[0].effectiveRunHash);

      // tune reads the baseline artifact it compares with, not where it lies.
      const tune = await readText(resolve(CLI_CWD, "../../examples/tutorials/04-cafe-tune.json"));
      const tuned = [];
      for (const [i, path] of copies.entries()) {
        const spec = resolve(dir, `tune${i}`, "tune.json");
        await writeText(spec, tune);
        const baseline = resolve(dir, `tune${i}`, "baseline.json");
        if (i === 0) runCli(["tune", path, "--tune", spec, "--artifact-out", baseline, "--format", "json"]);
        else await writeText(baseline, await readText(resolve(dir, "tune0", "baseline.json")));
        tuned.push(runCliJson(["tune", path, "--tune", spec, "--baseline-artifact", baseline, "--format", "json"])._meta);
      }
      expect(tuned[1].seed).toBe(tuned[0].seed);
      expect(tuned[1].runId).toBe(tuned[0].runId);
    } finally {
      await removePath(dir);
    }
  }, 180000);

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

  it("hashes the session pattern defaults experience runs", () => {
    const meta = (extra: string[]) => runCliJson(["experience", BASELINE, ...extra, "--format", "json"])._meta;
    // Without a declared pattern, experience runs always-on for 7 days.
    const plain = meta([]);
    const resolved = meta(["--session-pattern", "always-on", "--days", "7"]);
    expect(resolved.seed).toBe(plain.seed);
    expect(resolved.effectiveRunHash).toBe(plain.effectiveRunHash);
    expect(meta(["--seed", String(plain.seed), "--days", "6"]).effectiveRunHash).not.toBe(plain.effectiveRunHash);
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
    } finally {
      await removePath(dir);
    }
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

  it("keeps the default seed and hash for every flag that repeats what runs", async () => {
    const dir = await createTempDir("idlekit-identity-matrix");
    try {
      const body = JSON.parse(await readText(resolve(CLI_CWD, BASELINE)));
      const write = async (name: string, value: unknown) => {
        const path = resolve(dir, name);
        await writeText(path, JSON.stringify(value));
        return path;
      };
      const declared = await write("declared.json", {
        ...body,
        design: { sessionPattern: { id: "short-bursts", days: 1 } },
        analysis: { ...body.analysis, experience: { draws: 2 } },
        monetization: { uncertainty: { enabled: true, draws: 3 } },
      });
      const fast = await write("fast.json", { ...body, sim: { fast: true } });
      // An hour step keeps the default 90d ltv horizons short.
      const coarse = await write("coarse.json", { ...body, clock: { ...body.clock, stepSec: 3600 } });

      let n = 0;
      const meta = async (args: string[]) => {
        if (args[0] !== "evaluate") return runCliJson([...args, "--format", "json"])._meta;
        const outDir = resolve(dir, `evaluate${n++}`);
        runCli([...args, "--out-dir", outDir]);
        return readJson<any>(resolve(outDir, "summary.json")).then((x) => x._meta);
      };
      // Each `same` run spells out flags that repeat what `plain` runs. Each `other` run changes what
      // runs. `seed: false` marks a change to what the run keeps or reports, or to one evaluate stage,
      // which leaves the seed.
      type Case = Readonly<{
        plain: string[];
        same: string[][];
        other: Readonly<{ args: string[]; seed?: false }>[];
      }>;
      const cases: Case[] = [
        {
          plain: ["simulate", BASELINE],
          same: [
            [
              "simulate", BASELINE, "--duration", "1200", "--step", "1", "--strategy", "greedy", "--engine", "number",
              "--fast", "false", "--offline-seconds", "0", "--event-log-enabled", "true", "--run-id", "named",
            ],
          ],
          other: [
            { args: ["simulate", BASELINE, "--step", "2"] },
            { args: ["simulate", BASELINE, "--event-log-max", "5"], seed: false },
          ],
        },
        {
          plain: ["experience", declared],
          same: [
            [
              "experience", declared, "--session-pattern", "short-bursts", "--days", "1", "--draws", "2",
              "--strategy", "greedy", "--engine", "number", "--run-id", "named",
            ],
          ],
          other: [{ args: ["experience", declared, "--days", "2"] }],
        },
        {
          plain: ["ltv", declared, "--horizons", "30m"],
          same: [
            [
              "ltv", declared, "--horizons", " 30M,30m ", "--draws", "3", "--step", "1", "--strategy", "greedy",
              "--engine", "number", "--fast", "false",
            ],
          ],
          other: [{ args: ["ltv", declared, "--horizons", "30m", "--value-per-worth", "2"], seed: false }],
        },
        {
          plain: ["ltv", coarse],
          same: [["ltv", coarse, "--horizons", "90d,30d,7d,24h,2h,30m"]],
          other: [],
        },
        {
          plain: ["evaluate", declared, "--horizons", "30m"],
          same: [
            [
              "evaluate", declared, "--horizons", "30m,30m", "--strategy", "greedy", "--engine", "number", "--step", "1",
              "--fast", "false", "--consistent-overrides", "true", "--session-pattern", "short-bursts", "--days", "1",
              "--draws", "2",
            ],
          ],
          // Days change only the experience stage, so the shared seed stays.
          other: [{ args: ["evaluate", declared, "--horizons", "30m", "--days", "2"], seed: false }],
        },
        {
          plain: ["compare", BASELINE, fast, "--duration", "10"],
          same: [
            [
              "compare", BASELINE, fast, "--duration", "10", "--metric", "endNetWorth", "--step", "1", "--strategy", "greedy",
              "--max-duration", "86400",
              // endNetWorth does not read session flags or the milestone key.
              "--session-pattern", "twice-daily", "--days", "2", "--draws", "2", "--milestone-key", "x",
            ],
          ],
          other: [{ args: ["compare", BASELINE, fast, "--duration", "10", "--metric", "endMoney"] }],
        },
        {
          plain: ["compare", BASELINE, fast, "--duration", "10", "--metric", "visibleChangesPerMinute", "--days", "1"],
          same: [
            [
              "compare", BASELINE, fast, "--duration", "10", "--metric", "visibleChangesPerMinute", "--days", "1",
              "--session-pattern", "always-on", "--draws", "1",
            ],
          ],
          other: [
            {
              args: [
                "compare", BASELINE, fast, "--duration", "10", "--metric", "visibleChangesPerMinute", "--days", "1",
                "--session-pattern", "twice-daily",
              ],
            },
          ],
        },
      ];
      for (const { plain, same, other } of cases) {
        const base = await meta(plain);
        for (const args of same) {
          const flagged = await meta(args);
          expect([args, flagged.seed, flagged.effectiveRunHash]).toEqual([args, base.seed, base.effectiveRunHash]);
          // A named run keeps its name. Otherwise the run id reads the seed and the digest.
          if (!args.includes("--run-id")) expect([args, flagged.runId]).toEqual([args, base.runId]);
        }
        for (const { args, seed } of other) {
          const flagged = await meta(args);
          if (seed === false) expect([args, flagged.seed]).toEqual([args, base.seed]);
          else expect([args, flagged.seed]).not.toEqual([args, base.seed]);
          // compare has no stage digest. Its run id reads the run it resolves.
          if (base.effectiveRunHash !== undefined) {
            expect([args, flagged.effectiveRunHash]).not.toEqual([args, base.effectiveRunHash]);
          }
          // The evaluate run id is the simulate stage's, which days do not change.
          if (args[0] !== "evaluate") expect([args, flagged.runId]).not.toEqual([args, base.runId]);
        }
      }
    } finally {
      await removePath(dir);
    }
  }, 600000);
});
