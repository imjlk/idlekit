import { describe, expect, it } from "bun:test";
import { parseRegistryView, registryStatus } from "./npm-publish-preflight";

const pkg = (version: string) => ({ name: "@idlekit/core", version });

describe("npm publish preflight registry status", () => {
  it("publishes a package npm does not have yet", () => {
    expect(registryStatus(pkg("0.1.0"), null)).toMatchObject({ publishable: true, alreadyPublished: false, publishedVersion: null });
  });

  it("publishes a version newer than latest", () => {
    const status = registryStatus(pkg("0.7.0"), { versions: ["0.5.0", "0.6.0"], latest: "0.6.0" });
    expect(status).toMatchObject({ publishable: true, alreadyPublished: false, publishedVersion: "0.6.0" });
  });

  it("skips a version npm lists behind latest instead of blocking on it", () => {
    const status = registryStatus(pkg("0.5.0"), { versions: ["0.5.0", "0.6.0"], latest: "0.6.0" });
    expect(status).toMatchObject({ publishable: false, alreadyPublished: true });
  });

  it("treats a version published under another tag as published even when it is newer than latest", () => {
    const status = registryStatus(pkg("0.7.0"), { versions: ["0.6.0", "0.7.0"], latest: "0.6.0" });
    expect(status).toMatchObject({ publishable: false, alreadyPublished: true });
  });

  it("blocks an unpublished version older than latest, which would move latest backward", () => {
    const status = registryStatus(pkg("0.5.1"), { versions: ["0.5.0", "0.6.0"], latest: "0.6.0" });
    expect(status).toMatchObject({ publishable: false, alreadyPublished: false });
  });

  it("publishes an unlisted version when npm has no latest tag", () => {
    expect(registryStatus(pkg("0.1.0"), { versions: ["0.0.0-stage"], latest: null })).toMatchObject({ publishable: true });
  });

  it("parses npm view output for one and several versions", () => {
    expect(parseRegistryView(JSON.stringify({ "dist-tags": { latest: "0.6.0" }, versions: ["0.5.0", "0.6.0"] }))).toEqual({
      versions: ["0.5.0", "0.6.0"],
      latest: "0.6.0",
    });
    expect(parseRegistryView(JSON.stringify({ "dist-tags": { latest: "0.1.0" }, versions: "0.1.0" }))).toEqual({
      versions: ["0.1.0"],
      latest: "0.1.0",
    });
    expect(parseRegistryView(JSON.stringify({ versions: ["0.0.0-stage"] }))).toEqual({ versions: ["0.0.0-stage"], latest: null });
  });
});
