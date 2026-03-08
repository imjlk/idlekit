import { resolve } from "path";
import { hashContent } from "./outputMeta";
import type { OutputMeta } from "./outputMeta";
import { writeTextFile } from "../runtime/bun";

export type ReplayArtifactV1 = Readonly<{
  v: 1;
  kind: "idk.replay.artifact";
  artifactVersion: 1;
  contractVersion: string;
  schemaRef: string;
  command: string;
  generatedAt: string;
  meta: OutputMeta;
  input: Readonly<{
    positional: readonly string[];
    flags: Readonly<Record<string, unknown>>;
  }>;
  replay: Readonly<{
    cwd: string;
    args: readonly string[];
    commandLine: string;
    verify: Readonly<{
      runId: string;
      seed: number;
      scenarioHash: string | Readonly<Record<string, string>>;
      gitSha: string;
      pluginDigest: Readonly<Record<string, string>>;
      resultHash: string;
    }>;
  }>;
  result: unknown;
  extra?: Readonly<Record<string, unknown>>;
}>;

const REDACTED_KEYS = new Set([
  "generatedAt",
  "scenario",
  "scenarioPath",
  "resumedFrom",
  "stateOut",
  "_meta",
]);

export function canonicalizeReplayResult(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((x) => canonicalizeReplayResult(x));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = canonicalizeReplayResult(v);
  }
  return out;
}

export function hashReplayResult(value: unknown): string {
  return hashContent(canonicalizeReplayResult(value));
}

function quoteArg(x: string): string {
  if (/^[a-zA-Z0-9_./:@+-]+$/.test(x)) return x;
  return JSON.stringify(x);
}

function appendFlag(out: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (value === false) return;
  if (value === "") return;
  if (Array.isArray(value)) {
    for (const entry of value) appendFlag(out, key, entry);
    return;
  }
  const k = key.startsWith("--") ? key : `--${key}`;
  out.push(k, String(value));
}

export function buildReplayArgs(args: {
  command: string;
  positional: readonly string[];
  flags: Readonly<Record<string, unknown>>;
  omitFlags?: readonly string[];
  forcedFlags?: Readonly<Record<string, unknown>>;
}): readonly string[] {
  const out: string[] = [args.command, ...args.positional];
  const omit = new Set(args.omitFlags ?? []);
  const mergedFlags: Record<string, unknown> = {
    ...args.flags,
    ...(args.forcedFlags ?? {}),
  };

  for (const key of Object.keys(mergedFlags).sort()) {
    if (omit.has(key)) continue;
    appendFlag(out, key, mergedFlags[key]);
  }
  return out;
}

export function toReplayCommandLine(args: readonly string[]): string {
  const rendered = args.map((x) => quoteArg(x)).join(" ");
  return `bun run --cwd packages/cli dev -- ${rendered}`;
}

export async function writeReplayArtifact(args: {
  outPath: string;
  command: string;
  positional: readonly string[];
  flags: Readonly<Record<string, unknown>>;
  replayArgs: readonly string[];
  result: unknown;
  meta: OutputMeta;
  extra?: Readonly<Record<string, unknown>>;
}): Promise<string> {
  const abs = resolve(args.outPath);
  const runId = args.meta.runId;
  const seed = args.meta.seed;
  const scenarioHash = args.meta.scenarioHash;
  if (!runId) throw new Error("Replay artifact requires meta.runId");
  if (seed === undefined) throw new Error("Replay artifact requires meta.seed");
  if (!scenarioHash) throw new Error("Replay artifact requires meta.scenarioHash");
  const artifact: ReplayArtifactV1 = {
    v: 1,
    kind: "idk.replay.artifact",
    artifactVersion: 1,
    contractVersion: args.meta.contractVersion,
    schemaRef: "docs/schemas/artifact.v1.schema.json",
    command: args.command,
    generatedAt: new Date().toISOString(),
    meta: args.meta,
    input: {
      positional: [...args.positional],
      flags: args.flags,
    },
    replay: {
      cwd: process.cwd(),
      args: [...args.replayArgs],
      commandLine: toReplayCommandLine(args.replayArgs),
      verify: {
        runId,
        seed,
        scenarioHash,
        gitSha: args.meta.gitSha,
        pluginDigest: args.meta.pluginDigest,
        resultHash: hashReplayResult(args.result),
      },
    },
    result: args.result,
    extra: args.extra,
  };

  await writeTextFile(abs, `${JSON.stringify(artifact, null, 2)}\n`);
  return abs;
}
