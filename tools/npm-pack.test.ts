import { expect, test } from "bun:test";
import { parseNpmPackEntries } from "./npm-pack";

const money = { name: "@idlekit/money", version: "0.2.0", filename: "idlekit-money-0.2.0.tgz", files: [{ path: "dist/index.js", size: 42 }] };
const core = { name: "@idlekit/core", version: "0.2.0", filename: "idlekit-core-0.2.0.tgz", integrity: "sha512-fixture" };

test("reads npm 11 arrays and preserves the full pack report", () => {
  expect(parseNpmPackEntries(JSON.stringify([money, core], null, 2))).toEqual([money, core]);
});
test("reads npm 12 package-name maps and preserves the full pack report", () => {
  expect(parseNpmPackEntries(JSON.stringify({ [money.name]: money, [core.name]: core }, null, 2))).toEqual([money, core]);
});
for (const payload of [[money], { [money.name]: money }]) {
  test(`reads metadata after lifecycle output (${Array.isArray(payload) ? "array" : "map"})`, () => {
    expect(parseNpmPackEntries(`build report: {"done":true}\nPrepared publish manifest\n${JSON.stringify(payload, null, 2)}\n`)).toEqual([money]);
  });
}
for (const raw of ["not JSON", JSON.stringify([{ name: money.name }]), JSON.stringify({ error: "pack failed" }), `${JSON.stringify([money])}\nunexpected trailing output`]) {
  test(`rejects incomplete or unrelated pack output: ${raw.slice(0, 45)}`, () => {
    expect(() => parseNpmPackEntries(raw)).toThrow("valid package metadata");
  });
}
