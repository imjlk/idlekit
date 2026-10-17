import { lstatSync, realpathSync } from "fs";
import { open, rename, rm } from "fs/promises";
import { randomUUID } from "crypto";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "path";

/** Refuse source-checkout writes, including directory aliases and linked output files. */
export function resolveCaptureOutput(checkout: string, output: string): string {
  const requested = resolve(output);
  if (extname(requested).toLowerCase() !== ".json") throw new Error("Capture output must be a JSON file");
  const entry = lstatSync(requested, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink()) throw new Error("Capture output must not be a linked file");
  if (entry && !entry.isFile()) throw new Error("Capture output must be a regular file");
  if (entry && entry.nlink > 1) throw new Error("Capture output must not be a linked file");
  const canonical = resolve(realpathSync(dirname(requested)), basename(requested));
  const root = realpathSync(checkout);
  const normalize = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  const inside = relative(normalize(root), normalize(canonical));
  if (inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
    throw new Error("Capture output must be outside the reference game checkout");
  }
  return canonical;
}

export async function writeCaptureOutput(checkout: string, output: string, content: string): Promise<void> {
  const target = resolveCaptureOutput(checkout, output);
  const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx");
  try {
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    // Replace the directory entry instead of following a destination link introduced after validation.
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
