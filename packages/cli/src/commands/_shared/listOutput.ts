import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildOutputMeta } from "../../io/outputMeta";

export type ListFormat = "json" | "md" | "csv";

export async function writeListOutput<T extends Record<string, unknown>>(args: {
  format: ListFormat;
  out?: string;
  command: string;
  payload: T;
  render: (payload: T, format: ListFormat) => string;
}): Promise<void> {
  const outputForRender = (
    args.format === "json"
      ? {
          ...args.payload,
          _meta: buildOutputMeta({ command: args.command }),
        }
      : args.payload
  ) as T;
  const body = args.render(outputForRender, args.format);
  if (!args.out) {
    process.stdout.write(body);
    return;
  }

  const path = resolve(args.out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
  console.log(`Wrote ${args.format} output to ${path}`);
}
