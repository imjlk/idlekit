import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { OutputMeta } from "./outputMeta";

export type ReplayArtifactV1 = Readonly<{
  v: 1;
  kind: "idk.replay.artifact";
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
      runId?: string;
      seed?: number;
      scenarioHash?: string | Readonly<Record<string, string>>;
      gitSha?: string;
    }>;
  }>;
  result: unknown;
  extra?: Readonly<Record<string, unknown>>;
}>;

function quoteArg(x: string): string {
  if (/^[a-zA-Z0-9_./:@+-]+$/.test(x)) return x;
  return JSON.stringify(x);
}

function appendFlag(out: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
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
  const artifact: ReplayArtifactV1 = {
    v: 1,
    kind: "idk.replay.artifact",
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
        runId: args.meta.runId,
        seed: args.meta.seed,
        scenarioHash: args.meta.scenarioHash,
        gitSha: args.meta.gitSha,
      },
    },
    result: args.result,
    extra: args.extra,
  };

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return abs;
}
