import { cli } from "../src/main";
import { completionCandidates, completionScript } from "../src/runtime/completion";

const names = cli.commands.map(command => command.name);
if (new Set(names).size !== names.length) throw new Error("Duplicate root commands");
for (const required of ["validate", "simulate", "balance", "review", "complete", "completions"]) {
  if (!names.includes(required)) throw new Error(`Missing command: ${required}`);
}
for (const shell of ["bash", "zsh", "fish", "powershell"]) {
  if (!completionScript(shell).includes("idk complete")) throw new Error(`Missing ${shell} completion integration`);
}
if (!completionCandidates(cli.commands, ["compare", "--metric", ""]).length) throw new Error("Compare metric completion is empty");
console.log(`Gunshi registry and completions checked (${names.length} commands)`);
