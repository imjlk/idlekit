import packageJson from "../package.json" with { type: "json" };

const binName = Object.keys(packageJson.bin ?? {})[0];

export const CLI_NAME = typeof binName === "string" && binName.length > 0 ? binName : "idk";
export const CLI_VERSION = packageJson.version ?? "0.0.0";
export const CLI_DESCRIPTION = packageJson.description ?? "Bun-first idle game CLI";
