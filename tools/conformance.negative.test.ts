import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createNegativeWorkspace,
  removeNegativeWorkspace,
  runNegativeConformanceChecks,
  withoutNegativeEvidenceCitation,
} from "./conformance";
import { root, ttsxUnderNodeName } from "./evidence-host";

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The negative runner checks the missing transform against a transformed positive control.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the negative checks in this section: this function executes the transform pair, and separate mandatory registrations execute the Evidence and Graph pairs.
 * @evidence ./conformance.ts#runNegativeConformanceChecks The transform group rejects the missing transform and accepts its positive control.
 * @evidenceReview ./conformance.ts#runNegativeConformanceChecks #817b9ab Re-read the function and executed the split suite: it selects the requested negative harness group, while omission runs all groups. This test runs the transform group; separate mandatory tests run Evidence and Graph, whose positive controls pass and negative controls reject their missing prerequisites.
 * @evidence ./conformance.ts#createNegativeWorkspace Repeated allocation preserves the previous invocation's directory and contents.
 * @evidenceReview ./conformance.ts#createNegativeWorkspace #50b404d Read the allocator and ran the regression: two allocations differ and the first directory's sentinel remains intact.
 * @evidence ./conformance.ts#removeNegativeWorkspace A busy removal is retried with a bounded backoff. One that stays busy, or fails with another error, is reported.
 * @evidenceReview ./conformance.ts#removeNegativeWorkspace #0d08b25 Read the removal loop and ran the regression: two EBUSY failures settle after 100 and 200 ms pauses, a removal still busy after three attempts is reported, and EACCES is reported without a retry.
 */
export function runsTheNegativeConformanceRunner(): void {
  preservesInterruptedNegativeWorkspace();
  retriesBusyWorkspaceRemoval();
  removesCitationAcrossLineEndings();
  expect(() => runNegativeConformanceChecks("transform")).not.toThrow();
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The deleted citation fails with Missing acknowledgement after its positive control passes.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the negative citation check: this registration runs both Evidence controls, and validates LF and CRLF mutation before spawning the compiler.
 * @evidence ./conformance.ts#withoutNegativeEvidenceCitation Removes the exact pinned acknowledgment text from LF and CRLF hosts, preserves their remaining bytes, and returns undefined when it is absent.
 * @evidenceReview ./conformance.ts#withoutNegativeEvidenceCitation #3fc9a63 Re-read the helper and ran the LF and CRLF golden assertions: it matches the exact citation without its newline and removes only that text, keeping comments, code, and line endings. A host without the pinned text returns undefined.
 */
export function runsNegativeEvidenceChecks(): void {
  removesCitationAcrossLineEndings();
  expect(() => runNegativeConformanceChecks("evidence")).not.toThrow();
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The positive graph finds its host and the empty graph returns no requested declaration.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #bbb39a2 Re-read the negative graph check: this registration runs both Graph controls and keeps a missing host distinct from a failed lookup.
 * @evidence ./conformance.ts#runNegativeConformanceChecks Executes the Graph group and rejects a failed lookup separately from a successful lookup with no requested declaration.
 * @evidenceReview ./conformance.ts#runNegativeConformanceChecks #817b9ab Re-read the group selector and ran the protected Graph registration: it passes graph to the negative harness, whose positive control finds quotaHost and whose empty project successfully returns no quoteBudget declaration.
 */
export function runsNegativeGraphChecks(): void {
  expect(() => runNegativeConformanceChecks("graph")).not.toThrow();
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

function retriesBusyWorkspaceRemoval(): void {
  // The removal is injected, so this path is never touched.
  const work = join(tmpdir(), "idlekit-negative-busy-workspace");
  const failure = (code: string) => Object.assign(new Error(`${code}: removal failed`), { code });
  const pauses: number[] = [];
  let calls = 0;
  const settled = removeNegativeWorkspace(
    work,
    () => {
      calls += 1;
      if (calls < 3) throw failure("EBUSY");
    },
    (ms) => pauses.push(ms),
  );
  expect(settled).toBeUndefined();
  expect(pauses).toEqual([100, 200]);

  const stuck = removeNegativeWorkspace(
    work,
    () => {
      throw failure("EBUSY");
    },
    () => {},
    3,
  );
  expect(stuck).toContain("after 3 attempt(s)");

  let denied = 0;
  const fatal = removeNegativeWorkspace(
    work,
    () => {
      denied += 1;
      throw failure("EACCES");
    },
    () => {},
  );
  expect(denied).toBe(1);
  expect(fatal).toContain("EACCES");
}

function removesCitationAcrossLineEndings(): void {
  for (const newline of ["\n", "\r\n"]) {
    const host = [
      "/**",
      " * @evidence docs/spec.md#quota Returns the quota this section states, which is 3.",
      " * keep this comment",
      " */",
      "export function quoteBudget() { return 3; }",
      "",
    ].join(newline);
    const expected = [
      "/**", "", " * keep this comment", " */", "export function quoteBudget() { return 3; }", "",
    ].join(newline);
    expect(withoutNegativeEvidenceCitation(host)).toBe(expected);
  }
  expect(withoutNegativeEvidenceCitation("export function quoteBudget() { return 3; }\r\n")).toBeUndefined();
}

describe("DX-01 conformance harness", () => {
  it("runs the negative conformance runner", runsTheNegativeConformanceRunner, { timeout: 120_000 });
  it("checks both Evidence controls within their own deadline", runsNegativeEvidenceChecks, { timeout: 120_000 });
  it("checks both Graph controls within their own deadline", runsNegativeGraphChecks, { timeout: 120_000 });
  it("preserves an interrupted invocation when allocating another workspace", preservesInterruptedNegativeWorkspace);
  it("retries a busy workspace removal and reports one that stays busy", retriesBusyWorkspaceRemoval);
  it("removes the pinned citation from LF and CRLF hosts without changing other bytes", removesCitationAcrossLineEndings);

  it("gives the transform fixture its own pinned typia-only package boundary", () => {
    const fixture = JSON.parse(readFileSync(join(root, "fixtures/toolchain/bun-preload/package.json"), "utf8"));
    const workspace = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(fixture.private).toBe(true);
    expect(fixture.dependencies).toEqual({ typia: workspace.devDependencies.typia });
    expect(fixture.devDependencies).toBeUndefined();
  });

  it("gives the compiler and graph fixtures their own dependency-free package boundary", () => {
    // ttsc discovers plugins from the nearest package.json. Without one, a fixture
    // inherits the repository's @ttsc/lint and typia plugins.
    for (const rel of ["fixtures/evidence/base", "fixtures/graph/base", "fixtures/toolchain/graph-empty"]) {
      const manifest = JSON.parse(readFileSync(join(root, rel, "package.json"), "utf8"));
      expect({
        rel,
        private: manifest.private,
        workspaces: manifest.workspaces,
        dependencies: manifest.dependencies,
        devDependencies: manifest.devDependencies,
      }).toEqual({ rel, private: true, workspaces: undefined, dependencies: undefined, devDependencies: undefined });
    }
  });

  it("selects the Windows ttsx launcher", () => {
    expect(ttsxUnderNodeName("win32")).toBe("ttsx-under-node.cmd");
    expect(ttsxUnderNodeName("darwin")).toBe("ttsx-under-node");
  });
});
