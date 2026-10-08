import { generate } from "gunshi/generator";
import { cli } from "../src/main";
for (const leaf of ["evaluate", "compare", "doctor"]) {
  const entry = cli.getEntry();
  const help = await generate(["review", leaf], entry, cli.options(entry));
  if (!help.includes("Markdown")) throw new Error(`Review alias missing Markdown help: ${leaf}`);
}
console.log("Review report aliases checked");
