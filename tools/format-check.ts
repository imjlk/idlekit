import { commandText, root, runTtsc } from "./evidence-host";

const result = runTtsc(["-p", "tsconfig.format.json", "--noEmit", "--cwd", root], root);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
console.log(`format:check exit ${result.exitCode}`);
if (result.exitCode !== 0) {
  console.error(commandText(result).slice(0, 4000));
  process.exit(result.exitCode);
}
console.log("format:check passed");
