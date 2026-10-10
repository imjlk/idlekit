import { expect, test } from "bun:test";
import { inspectTarballListing } from "./tarball-check";

const packageFiles = ["package/LICENSE", "package/README.md", "package/dist/index.js"];

for (const [label, newline] of [["LF", "\n"], ["CRLF", "\r\n"]] as const) {
  test(`recognizes required documents in a ${label} tar listing`, () => {
    expect(inspectTarballListing(`${packageFiles.join(newline)}${newline}`)).toEqual({
      hasReadme: true,
      hasLicense: true,
      hasTestArtifacts: false,
    });
  });

  for (const [filename, flag] of [["README.md", "hasReadme"], ["LICENSE", "hasLicense"]] as const) {
    test(`reports a missing ${filename} in a ${label} tar listing`, () => {
      const files = packageFiles.filter((file) => file !== `package/${filename}`);
      expect(inspectTarballListing(files.join(newline))[flag]).toBe(false);
    });
  }

  test(`detects every forbidden test artifact in a ${label} tar listing`, () => {
    for (const extension of ["d.ts", "js", "js.map", "ts", "tsx"]) {
      const files = [...packageFiles, `package/dist/index.test.${extension}`, "package/package.json"];
      expect(inspectTarballListing(files.join(newline)).hasTestArtifacts).toBe(true);
    }
  });

  test(`does not treat similar filenames as documents or test artifacts (${label})`, () => {
    const files = ["package/README.md.backup", "package/LICENSE.txt", "package/dist/index.test.json"];
    expect(inspectTarballListing(files.join(newline))).toEqual({
      hasReadme: false,
      hasLicense: false,
      hasTestArtifacts: false,
    });
  });
}

test("reports no files in an empty tar listing", () => {
  expect(inspectTarballListing("\r\n\n")).toEqual({ hasReadme: false, hasLicense: false, hasTestArtifacts: false });
});
