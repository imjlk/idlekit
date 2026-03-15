import { resolve } from "path";
import cliPackageJson from "../../package.json" with { type: "json" };
import { runText, sha256Hex } from "../runtime/bun";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
export const OUTPUT_CONTRACT_VERSION = "1.4.0";
const UNKNOWN_GIT_SHA = "unknown";

const OUTPUT_SCHEMA_REF: Readonly<Record<string, string>> = {
  simulate: "docs/schemas/simulate.output.schema.json",
  eta: "docs/schemas/eta.output.schema.json",
  compare: "docs/schemas/compare.output.schema.json",
  doctor: "docs/schemas/doctor.output.schema.json",
  evaluate: "docs/schemas/evaluate.output.schema.json",
  experience: "docs/schemas/experience.output.schema.json",
  tune: "docs/schemas/tune.output.schema.json",
  ltv: "docs/schemas/ltv.output.schema.json",
  calibrate: "docs/schemas/calibrate.output.schema.json",
  "kpi.regress": "docs/schemas/kpi.regress.output.schema.json",
  "replay.verify": "docs/schemas/replay.verify.output.schema.json",
} as const;

export function stableStringify(value: unknown): string {
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
  return sha256Hex(value);
}

let cachedGitSha: string | undefined;
let hasResolvedGitSha = false;
function resolveGitSha(): string {
  if (hasResolvedGitSha) return cachedGitSha ?? UNKNOWN_GIT_SHA;
  hasResolvedGitSha = true;

  const envSha = process.env.GITHUB_SHA?.trim();
  if (envSha) {
    cachedGitSha = envSha;
    return cachedGitSha;
  }

  try {
    cachedGitSha = runText(["git", "rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      env: process.env,
    }).trim();
  } catch {
    cachedGitSha = UNKNOWN_GIT_SHA;
  }
  return cachedGitSha ?? UNKNOWN_GIT_SHA;
}

const cliVersion = cliPackageJson.version ?? "0.0.0";

export type OutputMeta = Readonly<{
  command: string;
  generatedAt: string;
  contractVersion: string;
  schemaRef?: string;
  cliVersion: string;
  gitSha: string;
  runId?: string;
  seed?: number;
  scenarioPath?: string | readonly string[];
  scenarioHash?: string | Readonly<Record<string, string>>;
  tuneSpecHash?: string;
  telemetryHash?: string;
  pluginDigest: Readonly<Record<string, string>>;
}>;

export function hashContent(value: unknown): string {
  return sha256(stableStringify(value));
}

export function deriveDeterministicSeed(value: unknown): number {
  const digest = hashContent(value);
  return Number.parseInt(digest.slice(0, 8), 16) >>> 0;
}

export function deriveDeterministicRunId(args: {
  command: string;
  seed: number;
  scope?: unknown;
}): string {
  const suffix = hashContent({
    command: args.command,
    seed: args.seed,
    scope: args.scope ?? null,
  }).slice(0, 8);
  return `${args.command}-${args.seed.toString(36)}-${suffix}`;
}

export function outputSchemaRefForCommand(command: string): string | undefined {
  return OUTPUT_SCHEMA_REF[command];
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
  pluginDigest?: Readonly<Record<string, string>>;
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
    contractVersion: OUTPUT_CONTRACT_VERSION,
    schemaRef: outputSchemaRefForCommand(args.command),
    cliVersion,
    gitSha: resolveGitSha(),
    runId: args.runId,
    seed: args.seed,
    scenarioPath: args.scenarioPath,
    scenarioHash,
    tuneSpecHash: args.tuneSpec !== undefined ? hashContent(args.tuneSpec) : undefined,
    telemetryHash: args.telemetry !== undefined ? hashContent(args.telemetry) : undefined,
    pluginDigest: args.pluginDigest ?? {},
  };
}

export function coerceOutputMetaCompat(input: unknown): OutputMeta {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid output meta: expected object");
  }
  const x = input as Record<string, unknown>;
  if (typeof x.command !== "string" || x.command.length === 0) {
    throw new Error("Invalid output meta: command(string) is required");
  }
  if (typeof x.generatedAt !== "string" || x.generatedAt.length === 0) {
    throw new Error("Invalid output meta: generatedAt(string) is required");
  }
  if (typeof x.cliVersion !== "string" || x.cliVersion.length === 0) {
    throw new Error("Invalid output meta: cliVersion(string) is required");
  }
  return {
    command: x.command,
    generatedAt: x.generatedAt,
    contractVersion: typeof x.contractVersion === "string" ? x.contractVersion : "1.0.0",
    schemaRef:
      typeof x.schemaRef === "string"
        ? x.schemaRef
        : outputSchemaRefForCommand(x.command),
    cliVersion: x.cliVersion,
    gitSha: typeof x.gitSha === "string" && x.gitSha.length > 0 ? x.gitSha : UNKNOWN_GIT_SHA,
    runId: typeof x.runId === "string" ? x.runId : undefined,
    seed: typeof x.seed === "number" && Number.isFinite(x.seed) ? x.seed : undefined,
    scenarioPath:
      typeof x.scenarioPath === "string" || Array.isArray(x.scenarioPath)
        ? (x.scenarioPath as string | readonly string[])
        : undefined,
    scenarioHash:
      typeof x.scenarioHash === "string" ||
      (x.scenarioHash && typeof x.scenarioHash === "object" && !Array.isArray(x.scenarioHash))
        ? (x.scenarioHash as string | Readonly<Record<string, string>>)
        : undefined,
    tuneSpecHash: typeof x.tuneSpecHash === "string" ? x.tuneSpecHash : undefined,
    telemetryHash: typeof x.telemetryHash === "string" ? x.telemetryHash : undefined,
    pluginDigest:
      x.pluginDigest && typeof x.pluginDigest === "object" && !Array.isArray(x.pluginDigest)
        ? (x.pluginDigest as Record<string, string>)
        : {},
  };
}
