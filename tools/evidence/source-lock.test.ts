import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { installSourceLock } from "./source-lock";

const prefix = resolve(tmpdir(), "idlekit-source-lock-test-");
const roots: string[] = [];
const original = "export const value = 42;\n";
function fixture() {
  const root = mkdtempSync(prefix);
  roots.push(root);
  const source = join(root, "source.ts");
  const other = join(root, "other.ts");
  const output = join(root, "output.txt");
  writeFileSync(source, original);
  writeFileSync(other, "replacement");
  return { root, source, other, output, lock: installSourceLock(root, [source]) };
}
function run(f: ReturnType<typeof fixture>, body: string) {
  return Bun.spawnSync([
    process.execPath, "--preload", f.lock.preload, "-e",
    `const fs = require("fs"); const [source, output, other] = process.argv.slice(1); ${body}`,
    f.source, f.output, f.other,
  ], { cwd: f.root, env: { ...process.env, IDLEKIT_EVIDENCE_LOCK: f.lock.env }, stdout: "pipe", stderr: "pipe" });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(prefix)) throw new Error("Unexpected source lock fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows a protected path as file contents without changing its source", () => {
  const f = fixture();
  const result = run(f, "fs.writeFileSync(output, source);");
  expect(result.exitCode).toBe(0);
  expect(readFileSync(f.output, "utf8")).toBe(f.source);
  expect(readFileSync(f.source, "utf8")).toBe(original);
});

test("allows copying a protected source into an unlocked output", () => {
  const f = fixture();
  const result = run(f, "fs.copyFileSync(source, output);");
  expect(result.exitCode).toBe(0);
  expect(readFileSync(f.output, "utf8")).toBe(original);
  expect(readFileSync(f.source, "utf8")).toBe(original);
});

const mutations = [
  ["write", 'fs.writeFileSync(source, "tampered");'],
  ["append", 'fs.appendFileSync(source, "tampered");'],
  ["copy destination", "fs.copyFileSync(other, source);"],
  ["rename source", "fs.renameSync(source, output);"],
  ["rename destination", "fs.renameSync(other, source);"],
  ["unlink", "fs.unlinkSync(source);"],
  ["remove", "fs.rmSync(source);"],
  ["Bun.write", 'await Bun.write(source, "tampered");'],
] as const;
for (const [name, body] of mutations) {
  test(`rejects ${name} of a protected source`, () => {
    const f = fixture();
    const result = run(f, body);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("evidence source is read-only");
    expect(readFileSync(f.source, "utf8")).toBe(original);
  });
}
