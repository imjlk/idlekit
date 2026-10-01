import { describe, expect, it } from "bun:test";
import { runNegativeConformanceChecks } from "./conformance";
import { ttsxUnderNodeName } from "./evidence-host";

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The negative runner checks a missing transform, a deleted citation, and an empty graph.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section, then ran this function: the three negative checks pass.
 * @evidence ./conformance.ts#runNegativeConformanceChecks The negative runner checks a missing transform, a deleted citation, and an empty graph.
 * @evidenceReview ./conformance.ts#runNegativeConformanceChecks #b3cf697 Re-read the function: it calls the negative harness. Ran it, and the missing transform, deleted citation, and empty graph fail closed.
 */
export function runsTheNegativeConformanceRunner(): void {
  expect(() => runNegativeConformanceChecks()).not.toThrow();
}

describe("DX-01 conformance harness", () => {
  it("runs the negative conformance runner", runsTheNegativeConformanceRunner, { timeout: 120_000 });

  it("selects the Windows ttsx launcher", () => {
    expect(ttsxUnderNodeName("win32")).toBe("ttsx-under-node.cmd");
    expect(ttsxUnderNodeName("darwin")).toBe("ttsx-under-node");
  });
});
