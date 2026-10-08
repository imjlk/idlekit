import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expandGlob } from "./program";

it("returns canonical repository paths for evidence glob matches", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "idlekit-evidence-glob-"));
  try {
    mkdirSync(join(workspace, "docs", "active"), { recursive: true });
    writeFileSync(join(workspace, "docs", "active", "spec.md"), "# Requirement\n");
    expect(await expandGlob("docs/**/*.md", workspace)).toEqual(["docs/active/spec.md"]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
