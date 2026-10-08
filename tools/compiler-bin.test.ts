import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { installedCompilerBin, ttsxLauncherPath } from "./compiler-bin";

describe("installed compiler launchers", () => {
  it("selects Bun executable shims on Windows and keeps POSIX launchers", () => {
    const root = mkdtempSync(join(tmpdir(), "idlekit-compiler-bin-"));
    const bin = join(root, "node_modules", ".bin");
    try {
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "ttsc.cmd"), "npm shim");
      expect(() => installedCompilerBin(root, "ttsc", "win32")).toThrow("bun install");
      writeFileSync(join(bin, "ttsc.exe"), "Bun shim");
      expect(installedCompilerBin(root, "ttsc", "win32")).toBe(join(bin, "ttsc.exe"));
      expect(installedCompilerBin(root, "ttsc", "linux")).toBe(join(bin, "ttsc"));
      expect(() => ttsxLauncherPath(root, "win32")).toThrow("bun install");
      writeFileSync(join(bin, "ttsx.exe"), "Bun shim");
      expect(ttsxLauncherPath(root, "win32")).toBe(join(bin, "ttsx.exe"));
      expect(ttsxLauncherPath(root, "darwin")).toBe(join(root, "tools", "ttsx-under-node"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
