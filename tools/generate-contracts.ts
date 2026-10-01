import { trackedDir, writeContracts } from "./contract-files";

if (process.argv.includes("--check") || process.argv.includes("--expected")) {
  console.error("contracts:generate does not compare. Use contracts:check.");
  process.exit(2);
}

const destFlag = process.argv.indexOf("--dest");
const dest = destFlag >= 0 ? process.argv[destFlag + 1] : trackedDir;
if (!dest) {
  console.error("missing --dest directory");
  process.exit(2);
}

writeContracts(dest);
console.log(`wrote ${dest}`);
