import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_JSON = resolve(THIS_DIR, "../../package.json");
const REPO_ROOT = resolve(THIS_DIR, "../../..");

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringify(x)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let cachedGitSha: string | undefined;
let hasResolvedGitSha = false;
function resolveGitSha(): string | undefined {
  if (hasResolvedGitSha) return cachedGitSha;
  hasResolvedGitSha = true;

  const envSha = process.env.GITHUB_SHA?.trim();
  if (envSha) {
    cachedGitSha = envSha;
    return cachedGitSha;
  }

  try {
    cachedGitSha = execSync("git rev-parse --short HEAD", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    cachedGitSha = undefined;
  }
  return cachedGitSha;
}

const cliVersion = (() => {
  try {
    const parsed = JSON.parse(readFileSync(CLI_PACKAGE_JSON, "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export type OutputMeta = Readonly<{
  command: string;
  generatedAt: string;
  cliVersion: string;
  gitSha?: string;
  runId?: string;
  seed?: number;
  scenarioPath?: string | readonly string[];
  scenarioHash?: string | Readonly<Record<string, string>>;
  tuneSpecHash?: string;
  telemetryHash?: string;
}>;

export function hashContent(value: unknown): string {
  return sha256(stableStringify(value));
}

export function buildOutputMeta(args: {
  command: string;
  runId?: string;
  seed?: number;
  scenarioPath?: string | readonly string[];
  scenario?: unknown;
  scenarios?: Readonly<Record<string, unknown>>;
  tuneSpec?: unknown;
  telemetry?: unknown;
}): OutputMeta {
  const scenarioHash = (() => {
    if (args.scenario !== undefined) return hashContent(args.scenario);
    if (args.scenarios) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.scenarios)) {
        out[k] = hashContent(v);
      }
      return out;
    }
    return undefined;
  })();

  return {
    command: args.command,
    generatedAt: new Date().toISOString(),
    cliVersion,
    gitSha: resolveGitSha(),
    runId: args.runId,
    seed: args.seed,
    scenarioPath: args.scenarioPath,
    scenarioHash,
    tuneSpecHash: args.tuneSpec !== undefined ? hashContent(args.tuneSpec) : undefined,
    telemetryHash: args.telemetry !== undefined ? hashContent(args.telemetry) : undefined,
  };
}
