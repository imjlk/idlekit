import { afterAll, expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCaptureOutput } from "./capture-output";

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
