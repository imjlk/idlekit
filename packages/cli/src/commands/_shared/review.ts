import { defineCommand, option, type CommandDefinition } from "../../runtime/command";

/** Review aliases share the normal report implementation and default to Markdown. */
export function markdownReview(command: CommandDefinition) {
  return defineCommand({
    name: command.name,
    description: command.description + " (Markdown review)",
    options: { ...command.options, format: option(command.options!.format!.schema.default("md"), { description: "Output format (default Markdown)" }) },
    handler: command.handler,
  });
}
