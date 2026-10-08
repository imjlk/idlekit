import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createCLI, defineCommand, defineGroup, option } from "./command";
import { completionCandidates, completionScript } from "./completion";

describe("Gunshi command boundary", () => {
  it("preserves explicit false, bare switches, negative numbers, and positional terminators", async () => {
    const cli = await createCLI({ name: "test", version: "1" });
    const calls: unknown[] = [];
    cli.command(defineCommand({ name: "run", description: "test", options: {
      fast: option(z.coerce.boolean().default(false)), seed: option(z.coerce.number().optional()),
    }, handler({ flags, positional }) { calls.push({ flags, positional }); } }));
    await cli.run(["run", "sample.json", "--fast", "false", "--seed", "-3"]);
    await cli.run(["run", "--fast", "--", "--literal.json"]);
    expect(calls).toEqual([
      { flags: { fast: false, seed: -3 }, positional: ["sample.json"] },
      { flags: { fast: true, seed: undefined }, positional: ["--literal.json"] },
    ]);
  });

  it("rejects unknown flags and invalid enum values before executing the handler", async () => {
    const cli = await createCLI({ name: "test", version: "1" });
    let calls = 0;
    cli.command(defineCommand({ name: "run", description: "test", options: {
      format: option(z.enum(["json", "md"]).default("json")),
    }, handler() { calls++; } }));
    await expect(cli.run(["run", "--missing", "value"])).rejects.toThrow();
    await expect(cli.run(["run", "--format", "xml"])).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("resolves grouped commands and completion enums from their live schemas", async () => {
    const leaf = defineCommand({ name: "list", description: "test", options: {
      format: option(z.enum(["json", "md"]).default("json")),
    }, handler() { called = true; } });
    let called = false;
    const group = defineGroup({ name: "models", description: "test", commands: [leaf] });
    const cli = await createCLI({ name: "test", version: "1" });
    cli.command(group);
    await cli.run(["models", "list", "--format", "json"]);
    expect(called).toBeTrue();
    expect(completionCandidates([group], ["models", ""])).toEqual(["list"]);
    expect(completionCandidates([group], ["models", "list", "--format", ""])).toEqual(["json", "md"]);
    for (const shell of ["bash", "zsh", "fish", "powershell"]) expect(completionScript(shell)).toContain("idk complete");
  });
});
