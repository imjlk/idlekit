export type NextStep = Readonly<{
  label: string;
  command: string;
}>;

function shouldPrintNextSteps(format?: string): boolean {
  if (!process.stdout.isTTY) return false;
  if (!format) return true;
  return format !== "json" && format !== "csv";
}

export function printNextSteps(args: {
  format?: string;
  steps: readonly NextStep[];
}): void {
  if (!shouldPrintNextSteps(args.format) || args.steps.length === 0) return;
  console.log("");
  console.log("Next:");
  for (const step of args.steps) {
    console.log(`- ${step.label}: ${step.command}`);
  }
}
