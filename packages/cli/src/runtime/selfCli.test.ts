import { describe, expect, it } from "bun:test";
import { join } from "path";
import { cliPackageRoot, isBundledCliProcess, selfCliCommand } from "./selfCli";

describe("CLI self invocation", () => {
  it("re-enters native executables from the real working directory", () => {
    const args = ["replay", "verify", "artifact.json"];
    for (const entry of ["/$bunfs/root/src/bin.ts", "B:/~BUN/root/src/bin.ts"]) {
      expect(isBundledCliProcess(entry)).toBeTrue();
      expect(cliPackageRoot(entry)).toBe(process.cwd());
      expect(selfCliCommand(args, entry)).toEqual([process.execPath, ...args]);
    }
  });

  it("retains source and JavaScript bundle classification", () => {
    const packageRoot = join(process.cwd(), "packages", "cli");
    expect(isBundledCliProcess(join(packageRoot, "src", "main.ts"))).toBeFalse();
    expect(isBundledCliProcess(join(packageRoot, "dist", "main.js"))).toBeTrue();
    expect(isBundledCliProcess(join(packageRoot, "dist", "main.mjs"))).toBeTrue();
    expect(cliPackageRoot(join(packageRoot, "dist", "main.js"))).toBe(packageRoot);
  });
});
