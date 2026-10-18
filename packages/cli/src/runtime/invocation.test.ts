import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { assertOutputNotInput } from "../io/writeOutput";
import { createTempDir, removePath, writeText } from "../testkit/bun";
import { invocationInputCandidates, recordInputRead, runWithInvocation } from "./invocation";

describe("invocation input candidates", () => {
  it("lists input flags and recorded reads, not ids or ordinary flag values", async () => {
    const candidates = runWithInvocation({
      positional: ["growth", "scenario.json"],
      flags: { format: "json", "run-id": "r1", rubric: "rubric.json", plugin: "a.mjs, b.mjs", out: "out.json" },
    }, () => {
      recordInputRead("scenario.json");
      return invocationInputCandidates();
    });
    expect(candidates).toEqual(["rubric.json", "a.mjs", "b.mjs", resolve("scenario.json")]);
    expect(runWithInvocation({ positional: [], flags: { resume: "state.json" } }, () => {
      recordInputRead("state.json");
      return invocationInputCandidates({ allow: ["resume"] });
    })).toEqual([]);
  });

  it("leaves an existing file named like a positional id writable until the command reads it", async () => {
    const dir = await createTempDir("idlekit-invocation");
    try {
      const growth = resolve(dir, "growth");
      await writeText(growth, "previous report\n");
      await runWithInvocation({ positional: [growth], flags: {} }, async () => {
        expect(await assertOutputNotInput(growth)).toBe(growth);
        recordInputRead(growth);
        await expect(assertOutputNotInput(growth)).rejects.toThrow("must not overwrite an input file");
      });
    } finally { await removePath(dir); }
  });
});
