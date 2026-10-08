import { describe, expect, it, spyOn } from "bun:test";
import { z } from "zod";
import { join } from "path";
import { createCLI, defineCommand, defineGroup, option } from "./command";

describe("Gunshi command boundary", () => {
  it("preserves explicit false, bare switches, negative numbers, and positional terminators", async () => {
    const cli = await createCLI({ name: "test", version: "1" });
    const calls: unknown[] = [];
    cli.command(defineCommand({ name: "run", description: "test", options: {
      fast: option(z.coerce.boolean().default(false)), seed: option(z.coerce.number().optional()),
    }, handler({ flags, positional }) { calls.push({ flags, positional }); } }));
    await cli.run(["run", "sample.json", "--fast", "false", "--seed", "-3"]);
    await cli.run(["run", "--fast", "--", "--literal.json"]);
    await cli.run(["run", "--", "-v"]);
    expect(calls).toEqual([
      { flags: { fast: false, seed: -3 }, positional: ["sample.json"] },
      { flags: { fast: true, seed: undefined }, positional: ["--literal.json"] },
      { flags: { fast: false, seed: undefined }, positional: ["-v"] },
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
    await expect(cli.run(["run", "--formt", "json"])).rejects.toThrow("Did you mean --format?");
    await expect(cli.run(["rn"])).rejects.toThrow("Did you mean run?");
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
  });

  it("uses Gunshi completion scripts for four shells and preserves Bash filename fallback", async () => {
    const cli = await createCLI({ name: "test", version: "1" });
    cli.command(defineCommand({ name: "run", description: "test", handler() {} }));
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation((value) => { output.push(String(value)); });
    try {
      for (const shell of ["bash", "zsh", "fish", "powershell"]) {
        const before = output.length;
        await cli.run(["complete", shell]);
        expect(output.length).toBeGreaterThan(before);
      }
      const bashScript = output.slice(0, 2).join("\n");
      const bash = process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "bash";
      const sourced = Bun.spawnSync([bash, "--noprofile", "--norc", "-c", `${bashScript}
registration=$(complete -p test)
[[ "$registration" == *"-o default"* && "$registration" == *"-o bashdefault"* ]] || exit 3
function_name=\${registration#* -F }
function_name=\${function_name%% *}
declare -F "$function_name" >/dev/null || exit 4
test() { printf ':4\\n'; }
compopt() { fallback_options="$*"; }
_get_comp_words_by_ref() { cur=\${COMP_WORDS[COMP_CWORD]}; prev=\${COMP_WORDS[COMP_CWORD-1]}; words=("\${COMP_WORDS[@]}"); cword=$COMP_CWORD; }
COMP_WORDS=(test run ./sample)
COMP_CWORD=2
"$function_name"
[[ "$fallback_options" == "-o default -o bashdefault" ]] || exit 5
`], { stdout: "pipe", stderr: "pipe" });
      expect(sourced.stderr.toString()).toBe("");
      expect(sourced.exitCode).toBe(0);
    } finally { log.mockRestore(); }
  });

  it("advances completion past boolean switches and completes enum values", async () => {
    const cli = await createCLI({ name: "test", version: "1" });
    cli.command(defineCommand({ name: "run", description: "test", options: {
      fast: option(z.coerce.boolean().default(false)), format: option(z.enum(["json", "md"]).default("json")),
    }, handler() {} }));
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation(value => { output.push(String(value)); });
    try {
      for (const flag of ["--fast", "--no-fast"]) {
        output.length = 0;
        await cli.run(["complete", "--", "run", flag, ""]);
        expect(output.join("\n")).not.toMatch(/^(true|false)\t/m);
        output.length = 0;
        await cli.run(["complete", "--", "run", flag, "--f"]);
        expect(output.join("\n")).toContain("--format");
      }
      output.length = 0;
      await cli.run(["complete", "--", "run", "--format", ""]);
      expect(output.join("\n")).toContain("json");
      expect(output.join("\n")).toContain("md");
    } finally { log.mockRestore(); }
  });
});
