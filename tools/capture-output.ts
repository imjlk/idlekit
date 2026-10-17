import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

/** Refuse source-checkout writes, including directory aliases and linked output files. */
export function resolveCaptureOutput(checkout: string, output: string): string {
  const requested = resolve(output);
  if (extname(requested).toLowerCase() !== ".json") throw new Error("Capture output must be a JSON file");
  const entry = lstatSync(requested, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink() || (entry && entry.nlink > 1)) throw new Error("Capture output must not be a linked file");
  const canonical = resolve(realpathSync(dirname(requested)), basename(requested));
  const root = realpathSync(checkout);
  const normalize = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  const inside = relative(normalize(root), normalize(canonical));
  if (inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
    throw new Error("Capture output must be outside the reference game checkout");
  }
  return canonical;
}
