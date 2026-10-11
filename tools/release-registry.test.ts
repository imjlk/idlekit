import { describe, expect, it } from "bun:test";
import { checkRegistryManifest, planPublication, type ReleaseVersion } from "./release-registry";

const versions: ReleaseVersion[] = [
  { name: "@idlekit/money", version: "0.2.0", published: true },
  { name: "@idlekit/core", version: "0.2.2", published: false },
  { name: "@idlekit/cli", version: "0.2.2", published: false },
];
const ready = { pendingChangesets: 0, selectedIsMain: true, versions };

describe("publication plan", () => {
  it("publishes the unpublished versions once the release PR consumed every changeset", () => {
    for (const manual of [false, true]) {
      expect(planPublication({ manual, ...ready })).toEqual({
        publish: true,
        reason: "publishing @idlekit/core@0.2.2, @idlekit/cli@0.2.2",
        packages: ["@idlekit/core@0.2.2", "@idlekit/cli@0.2.2"],
      });
    }
  });

  it("skips a push that cannot publish and fails the same manual request", () => {
    const cases = [
      [{ ...ready, pendingChangesets: 2 }, "2 pending changeset(s)"],
      [{ ...ready, selectedIsMain: false }, "main moved past this commit"],
      [{ ...ready, versions: versions.map((entry) => ({ ...entry, published: true })) }, "already on npm"],
    ] as const;
    for (const [input, reason] of cases) {
      const pushed = planPublication({ manual: false, ...input });
      expect(pushed.publish).toBeFalse();
      expect(pushed.packages).toEqual([]);
      expect(pushed.reason).toContain(reason);
      expect(() => planPublication({ manual: true, ...input })).toThrow(reason);
    }
  });

  it("checks pending changesets before the main head and the registry", () => {
    const plan = planPublication({ manual: false, pendingChangesets: 1, selectedIsMain: false, versions: [] });
    expect(plan.reason).toContain("pending changeset");
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

  it("requires provenance only for versions this run published", () => {
    expect(checkRegistryManifest("@idlekit/money@0.2.0", {}, false)).toEqual([]);
    expect(checkRegistryManifest("@idlekit/money@0.2.1", {}, true)).toEqual(["@idlekit/money@0.2.1 has no provenance attestation"]);
  });
});
