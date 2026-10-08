import { existsSync } from "fs";
import { join } from "path";

type CompilerName = "ttsc" | "ttsc-graph" | "ttsx" | "tsc";

/** Bun's native Windows shims can be spawned directly without a shell. */
export function installedCompilerBin(root: string, name: CompilerName, platform: NodeJS.Platform = process.platform): string {
  const base = join(root, "node_modules", ".bin", name);
  if (platform !== "win32") return base;
  if (existsSync(`${base}.exe`)) return `${base}.exe`;
  throw new Error(`Windows tooling requires Bun's installed ${name}.exe shim. Run bun install.`);
}

/** A Windows executable can be spawned by Node without the shell required by cmd files. */
export function ttsxLauncherPath(root: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const executable = join(root, "node_modules", ".bin", "ttsx.exe");
    if (!existsSync(executable)) throw new Error("Windows tooling requires Bun's installed node_modules/.bin/ttsx.exe shim. Run bun install.");
    return executable;
  }
  return join(root, "tools", "ttsx-under-node");
}
