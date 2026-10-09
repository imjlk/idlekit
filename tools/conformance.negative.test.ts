import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNegativeWorkspace, runNegativeConformanceChecks } from "./conformance";
import { root, ttsxUnderNodeName } from "./evidence-host";

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The negative runner checks a missing transform, a deleted citation, and an empty graph.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #f518b31 Re-read the section, then ran this function: the three negative checks pass.
 * @evidence ./conformance.ts#runNegativeConformanceChecks The negative runner checks a missing transform, a deleted citation, and an empty graph.
 * @evidenceReview ./conformance.ts#runNegativeConformanceChecks #b3cf697 Re-read the function: it calls the negative harness. Ran it, and the missing transform, deleted citation, and empty graph fail closed.
 * @evidence ./conformance.ts#createNegativeWorkspace Repeated allocation preserves the previous invocation's directory and contents.
 * @evidenceReview ./conformance.ts#createNegativeWorkspace #50b404d Read the allocator and ran the regression: two allocations differ and the first directory's sentinel remains intact.
 */
export function runsTheNegativeConformanceRunner(): void {
  preservesInterruptedNegativeWorkspace();
  expect(() => runNegativeConformanceChecks()).not.toThrow();
}

function preservesInterruptedNegativeWorkspace(): void {
  const base = mkdtempSync(join(tmpdir(), "idlekit-negative-workspace-"));
  try {
    const interrupted = createNegativeWorkspace(base);
    const sentinel = join(interrupted, "still-owned.txt");
    writeFileSync(sentinel, "preserve");
    const next = createNegativeWorkspace(base);
    expect(next).not.toBe(interrupted);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

describe("DX-01 conformance harness", () => {
  it("runs the negative conformance runner", runsTheNegativeConformanceRunner, { timeout: 120_000 });
  it("preserves an interrupted invocation when allocating another workspace", preservesInterruptedNegativeWorkspace);

  it("gives the transform fixture its own pinned typia-only package boundary", () => {
    const fixture = JSON.parse(readFileSync(join(root, "fixtures/toolchain/bun-preload/package.json"), "utf8"));
    const workspace = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(fixture.private).toBe(true);
    expect(fixture.dependencies).toEqual({ typia: workspace.devDependencies.typia });
    expect(fixture.devDependencies).toBeUndefined();
  });

  it("selects the Windows ttsx launcher", () => {
    expect(ttsxUnderNodeName("win32")).toBe("ttsx-under-node.cmd");
    expect(ttsxUnderNodeName("darwin")).toBe("ttsx-under-node");
  });
});
