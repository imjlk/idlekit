export {};

if (process.argv.includes("--write") || process.argv.includes("--dest")) {
  console.error("contracts:check does not write tracked schemas");
  process.exit(2);
}

const expectedFlag = process.argv.indexOf("--expected");
const expectedDir = expectedFlag >= 0 ? process.argv[expectedFlag + 1] : undefined;
if (expectedFlag >= 0 && (!expectedDir || expectedDir.startsWith("-"))) {
  console.error(
    expectedDir ? "invalid --expected directory: expected a path, received a flag" : "missing --expected directory",
  );
  process.exit(2);
}

// Reject invalid arguments before loading the transformed schema generators.
const { compareContracts, trackedDir } = await import("./contract-files");
const dir = expectedDir ?? trackedDir;
const failures = compareContracts(dir);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log("contracts:check passed");
