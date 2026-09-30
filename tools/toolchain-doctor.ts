import { inspectToolchain } from "./toolchain-host";

const report = inspectToolchain();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
