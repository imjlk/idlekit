import { generate } from "gunshi/generator";
import { cli } from "../src/main";
import { commandNames } from "../src/runtime/command";
const names = commandNames();
if (new Set(names).size !== names.length) throw new Error("Duplicate root commands");
for (const required of ["validate", "simulate", "balance", "review", "complete"]) if (!names.includes(required)) throw new Error(`Missing command: ${required}`);
for (const path of [null, ["models", "list"], ["review", "evaluate"], ["setup", "completions"]]) {
  const entry = cli.getEntry();
  const usage = await generate(path, entry, cli.options(entry));
  if (!usage.includes("idk")) throw new Error(`Missing help for ${path}`);
}
console.log(`Gunshi command tree and help checked (${names.length} commands)`);
