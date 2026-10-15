import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sourceGraph, unresolvedLocalRequires } from "./source-graph";

function scan(body: string) {
  const temporary = mkdtempSync(join(tmpdir(), "idlekit-runtime-imports-"));
  const host = join(temporary, "host.js");
  const helper = join(temporary, "helper.js");
  writeFileSync(host, body);
  writeFileSync(helper, "export const realHelper = 1; // runtime-helper-marker");
  try {
    return { bodies: sourceGraph([host]), faults: unresolvedLocalRequires([host]) };
  } finally {
    unlinkSync(host);
    unlinkSync(helper);
    rmdirSync(temporary);
  }
}

describe("runtime dependency comments", () => {
  it("ignores JSDoc type imports and documented require examples", () => {
    const result = scan(`/** @template {import('./types/index').URIComponent|string} T */
/**
 * @param {import('../types/index').URIComponent} value
 * Example: require('./documented-only')
 * const load = createRequire(import.meta.url); load('./another-example');
 */
export const value = 1;`);
    expect(result.faults).toEqual([]);
    expect(result.bodies).toHaveLength(1);
  });

  it("still follows real require and dynamic import calls after JSDoc", () => {
    for (const load of ["require('./helper')", "import('./helper')"]) {
      const result = scan(`/** @type {import('./types/index').Box} */\n${load};`);
      expect(result.faults).toEqual([]);
      expect(result.bodies.some(body => body.includes("runtime-helper-marker"))).toBeTrue();
    }
  });

  it("still reports missing runtime modules and computed imports", () => {
    for (const load of ["require('./missing-runtime')", "import('./missing-runtime')"]) {
      expect(scan(`/** @type {import('./types/index').Box} */\n${load};`).faults).toEqual(["./missing-runtime"]);
    }
    expect(scan("/** @type {import('./types/index').Box} */\nimport(target);").faults).toEqual(["dynamic import"]);
  });

  it("ignores JSDoc inside template interpolation while following executable expressions", () => {
    const result = scan("const text = `${/** @type {import('./types/index').Box} */ require('./helper')}`;");
    expect(result.faults).toEqual([]);
    expect(result.bodies.some(body => body.includes("runtime-helper-marker"))).toBeTrue();
  });
});
