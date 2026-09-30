import { join } from "path";
import { assertTtscArgv, fixtureEnv, inspectToolchain, root, runCommand, ttscBin } from "./toolchain-host";

const report = inspectToolchain();
if (!report.ok) {
  console.error(report.failures.join("\n"));
  process.exit(1);
}

const projects = [
  join(root, "fixtures/toolchain/typia/tsconfig.json"),
  join(root, "fixtures/toolchain/evidence/tsconfig.json"),
];

for (const project of projects) {
  const args = [ttscBin, "prepare", "-p", project, "--cwd", root];
  assertTtscArgv(args);
  const result = runCommand(args, { cwd: root, env: fixtureEnv() });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

const paths = runCommand([ttscBin, "cache", "paths", "--json", "--cwd", root], {
  cwd: root,
  env: fixtureEnv(),
});
process.stdout.write(paths.stdout);
process.stderr.write(paths.stderr);
if (paths.exitCode !== 0) process.exit(paths.exitCode);
