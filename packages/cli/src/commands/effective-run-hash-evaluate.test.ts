import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { CLI_CWD, createTempDir, readJson, readText, removePath, runCli, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

describe("effectiveRunHash", () => {
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
