import { describe, expect, it } from "bun:test";
import { checkRegistryManifest, compareSemver, planPublication, PROVENANCE_EXEMPT, type ReleaseVersion } from "./release-registry";

const versions: ReleaseVersion[] = [
  { name: "@idlekit/money", version: "0.2.0", published: true, latest: "0.2.0" },
  { name: "@idlekit/core", version: "0.2.2", published: false, latest: "0.2.1" },
  { name: "@idlekit/cli", version: "0.2.2", published: false, latest: "0.2.1" },
];
const ready = { pendingChangesets: 0, selectedIsMain: true, versions };
const allPublished = versions.map((entry) => ({ ...entry, published: true }));

describe("publication plan", () => {
  it("publishes the unpublished versions once the release PR consumed every changeset", () => {
    for (const manual of [false, true]) {
      expect(planPublication({ manual, ...ready })).toEqual({
        publish: true,
        verify: true,
        reason: "publishing @idlekit/core@0.2.2, @idlekit/cli@0.2.2",
      });
    }
  });

  it("skips a push that cannot publish and fails the same manual request", () => {
    const cases = [
      [{ ...ready, pendingChangesets: 2 }, "2 pending changeset(s)"],
      [{ ...ready, selectedIsMain: false }, "main moved past this commit"],
    ] as const;
    for (const [input, reason] of cases) {
      expect(planPublication({ manual: false, ...input })).toEqual({ publish: false, verify: false, reason: expect.stringContaining(reason) });
      expect(() => planPublication({ manual: true, ...input })).toThrow(reason);
    }
  });

  it("skips a push with nothing new and lets a manual retry verify the registry", () => {
    expect(planPublication({ manual: false, ...ready, versions: allPublished }))
      .toEqual({ publish: false, verify: false, reason: "every package version is already on npm." });
    expect(planPublication({ manual: true, ...ready, versions: allPublished }))
      .toEqual({ publish: false, verify: true, reason: expect.stringContaining("verifying the registry only") });
  });

  it("refuses an unpublished version older than npm latest on a push or a manual run", () => {
    const behind = [{ name: "@idlekit/core", version: "0.2.0-rc.1", published: false, latest: "0.2.1" }];
    for (const manual of [false, true]) {
      expect(() => planPublication({ manual, ...ready, versions: behind })).toThrow("@idlekit/core@0.2.0-rc.1 is older than npm latest 0.2.1");
    }
    const fresh = [{ name: "@idlekit/new", version: "0.1.0", published: false, latest: null }];
    expect(planPublication({ manual: false, ...ready, versions: fresh }).publish).toBeTrue();
  });

  it("checks pending changesets before the main head and the registry", () => {
    const plan = planPublication({ manual: false, pendingChangesets: 1, selectedIsMain: false, versions: [] });
    expect(plan.reason).toContain("pending changeset");
  });

  it("orders semver releases after their prereleases", () => {
    expect(compareSemver("0.2.1", "0.2.0")).toBeGreaterThan(0);
    expect(compareSemver("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0", "0.2.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0", "0.2.0")).toBe(0);
  });

  it("orders prerelease identifiers by SemVer precedence", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareSemver(ordered[i]!, ordered[i - 1]!)).toBeGreaterThan(0);
      expect(compareSemver(ordered[i - 1]!, ordered[i]!)).toBeLessThan(0);
    }
    expect(compareSemver("0.2.0-rc.10", "0.2.0-rc.2")).toBeGreaterThan(0);
  });
});

describe("registry manifest check", () => {
  const provenance = { dist: { attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } } } };

  it("accepts concrete internal versions with provenance", () => {
    expect(checkRegistryManifest("@idlekit/cli@0.2.2", { dependencies: { "@idlekit/core": "0.2.2" }, ...provenance }, true)).toEqual([]);
  });

  it("rejects workspace specs in any installed dependency section", () => {
    const problems = checkRegistryManifest("@idlekit/core@0.2.0", {
      dependencies: { "@idlekit/money": "workspace:*" },
      peerDependencies: { "@idlekit/cli": "workspace:^" },
      ...provenance,
    }, true);
    expect(problems).toEqual([
      "@idlekit/core@0.2.0 lists dependencies.@idlekit/money=workspace:* in its registry metadata",
      "@idlekit/core@0.2.0 lists peerDependencies.@idlekit/cli=workspace:^ in its registry metadata",
    ]);
  });

  it("requires provenance except for the locally bootstrapped versions", () => {
    expect([...PROVENANCE_EXEMPT]).toEqual(["@idlekit/money@0.2.0"]);
    expect(checkRegistryManifest("@idlekit/money@0.2.0", {}, false)).toEqual([]);
    expect(checkRegistryManifest("@idlekit/money@0.2.1", {}, true)).toEqual(["@idlekit/money@0.2.1 has no provenance attestation"]);
  });
});
