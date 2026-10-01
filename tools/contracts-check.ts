import { compareContracts, trackedDir } from "./contract-files";

if (process.argv.includes("--write") || process.argv.includes("--dest")) {
  console.error("contracts:check does not write tracked schemas");
  process.exit(2);
}

const expectedFlag = process.argv.indexOf("--expected");
const dir = expectedFlag >= 0 ? process.argv[expectedFlag + 1] : trackedDir;
if (!dir) {
  console.error("missing --expected directory");
  process.exit(2);
}

const failures = compareContracts(dir);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log("contracts:check passed");
