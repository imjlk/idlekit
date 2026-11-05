import { describe, expect, it } from "bun:test";
import { createCLI, defineCommand } from "../../runtime/command";
import { MAX_SEED, seedOption, seedSchema } from "./seed";

describe("--seed validation", () => {
  it("accepts unsigned 32-bit integers, including both bounds", () => {
    for (const raw of ["0", "1", "42", String(MAX_SEED)]) {
      expect(seedSchema.parse(raw)).toBe(Number(raw));
    }
  });

  it("rejects fractional, negative, too large, and non-numeric seeds", () => {
    for (const raw of ["1.2", "1.7", "-1", String(MAX_SEED + 1), "1e20", "abc", "NaN", "Infinity"]) {
      expect(seedSchema.safeParse(raw).success).toBeFalse();
    }
  });

  it("fails before the handler runs, so a recorded seed is always the seed that ran", async () => {
    const cli = await createCLI({ name: "test", version: "1" });
    const seen: unknown[] = [];
    cli.command(defineCommand({ name: "run", description: "test", options: { seed: seedOption("Seed") },
      handler({ flags }) { seen.push(flags.seed); } }));
    await cli.run(["run", "--seed", "7"]);
    await cli.run(["run"]);
    await expect(cli.run(["run", "--seed", "1.2"])).rejects.toThrow("Invalid --seed");
    await expect(cli.run(["run", "--seed", "-3"])).rejects.toThrow("Invalid --seed");
    await expect(cli.run(["run", "--seed", "4294967296"])).rejects.toThrow("Invalid --seed");
    expect(seen).toEqual([7, undefined]);
  });
});
