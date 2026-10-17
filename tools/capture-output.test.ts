import { afterAll, expect, test } from "bun:test";
import { closeSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCaptureOutput, writeCaptureOutput } from "./capture-output";

const root = mkdtempSync(join(tmpdir(), "idlekit-capture-output-"));
const game = join(root, "game");
const outside = join(root, "outside");
mkdirSync(game); mkdirSync(outside);
const source = join(game, "source.json");
writeFileSync(source, "game source");
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

test("allows an ordinary JSON output outside the reference checkout", () => {
  expect(resolveCaptureOutput(game, join(outside, "result.json"))).toBe(join(realpathSync(outside), "result.json"));
});
test("refuses existing and new outputs inside the reference checkout", () => {
  expect(() => resolveCaptureOutput(game, source)).toThrow(/checkout/);
  expect(() => resolveCaptureOutput(game, join(game, "new.json"))).toThrow(/checkout/);
  expect(readFileSync(source, "utf8")).toBe("game source");
});
test("refuses non-JSON output paths", () => {
  expect(() => resolveCaptureOutput(game, join(outside, "model.ts"))).toThrow(/JSON/);
});
test("resolves directory aliases before enforcing the checkout boundary", () => {
  const alias = join(outside, "alias");
  symlinkSync(game, alias, process.platform === "win32" ? "junction" : "dir");
  expect(() => resolveCaptureOutput(game, join(alias, "new.json"))).toThrow(/checkout/);
});
test("refuses hard-linked output files", () => {
  const alias = join(outside, "linked.json");
  linkSync(source, alias);
  expect(() => resolveCaptureOutput(game, alias)).toThrow(/linked/);
  expect(readFileSync(source, "utf8")).toBe("game source");
});

test("refuses directories instead of treating them as output files", () => {
  const directory = join(outside, "directory.json");
  mkdirSync(directory);
  expect(() => resolveCaptureOutput(game, directory)).toThrow(/regular file/);
});
test.skipIf(process.platform === "win32")("refuses named pipes before starting a write", () => {
  const fifo = join(outside, "pipe.json");
  execFileSync("mkfifo", [fifo]);
  expect(() => resolveCaptureOutput(game, fifo)).toThrow(/regular file/);
});
test("publishes a complete replacement for an existing output", async () => {
  const output = join(outside, "existing.json");
  writeFileSync(output, "old");
  await writeCaptureOutput(game, output, "new");
  expect(readFileSync(output, "utf8")).toBe("new");
});
// Windows can lock open destination handles against rename; POSIX keeps the old inode readable.
test.skipIf(process.platform === "win32")("publishes a replacement without modifying the old file contents", async () => {
  const output = join(outside, "replace.json");
  writeFileSync(output, "old");
  const original = openSync(output, "r");
  try {
    await writeCaptureOutput(game, output, "new");
    expect(readFileSync(output, "utf8")).toBe("new");
    expect(readFileSync(original, "utf8")).toBe("old");
  } finally { closeSync(original); }
});
test("rechecks a destination replaced by a link after preflight", async () => {
  const output = resolveCaptureOutput(game, join(outside, "substituted.json"));
  linkSync(source, output);
  await expect(writeCaptureOutput(game, output, "replacement")).rejects.toThrow(/linked/);
  expect(readFileSync(source, "utf8")).toBe("game source");
});
