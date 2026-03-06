import { resolve } from "node:path";
import type { OutputMeta } from "./outputMeta";
import { buildReplayArgs, type ReplayArtifactV1, writeReplayArtifact } from "./replayArtifact";

type ReplayCommand = "simulate" | "compare" | "ltv" | "tune";

const REPLAY_POLICIES: Readonly<Record<ReplayCommand, { omitFlags: readonly string[] }>> = {
  simulate: {
    omitFlags: ["out", "artifact-out", "state-out"],
  },
  compare: {
    omitFlags: ["out", "artifact-out"],
  },
  ltv: {
    omitFlags: ["out", "artifact-out"],
  },
  tune: {
    omitFlags: ["out", "artifact-out", "baseline-artifact", "fail-on-regression", "regression-tolerance"],
  },
};

const PATH_FLAG_KINDS: Readonly<Record<string, "path" | "csvPath" | "pathEqDigestList">> = {
  plugin: "csvPath",
  "plugin-root": "csvPath",
  "plugin-trust-file": "path",
  resume: "path",
  tune: "path",
  "baseline-artifact": "path",
  baseline: "path",
  current: "path",
  "plugin-sha256": "pathEqDigestList",
};

function normalizePathLike(pathLike: string, cwd: string): string {
  if (pathLike.trim().length === 0) return pathLike;
  return resolve(cwd, pathLike);
}

function normalizeCsvPaths(raw: string, cwd: string): string {
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => normalizePathLike(x, cwd))
    .join(",");
}

function normalizePathEqDigestList(raw: string, cwd: string): string {
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("=");
      if (idx <= 0 || idx === entry.length - 1) return entry;
      const path = entry.slice(0, idx).trim();
      const digest = entry.slice(idx + 1).trim();
      return `${normalizePathLike(path, cwd)}=${digest}`;
    })
    .join(",");
}

function normalizeReplayFlagValue(key: string, value: unknown, cwd: string): unknown {
  const kind = PATH_FLAG_KINDS[key];
  if (!kind) return value;
  if (typeof value !== "string") return value;
  if (value.trim().length === 0) return value;
  switch (kind) {
    case "path":
      return normalizePathLike(value, cwd);
    case "csvPath":
      return normalizeCsvPaths(value, cwd);
    case "pathEqDigestList":
      return normalizePathEqDigestList(value, cwd);
    default:
      return value;
  }
}

function normalizeReplayFlags(
  flags: Readonly<Record<string, unknown>>,
  cwd: string,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    out[key] = normalizeReplayFlagValue(key, value, cwd);
  }
  return out;
}

export async function writeCommandReplayArtifact(args: {
  command: ReplayCommand;
  outPath: string;
  positional: readonly string[];
  flags: Readonly<Record<string, unknown>>;
  forcedFlags?: Readonly<Record<string, unknown>>;
  result: unknown;
  meta: OutputMeta;
  extra?: ReplayArtifactV1["extra"];
}): Promise<string> {
  const policy = REPLAY_POLICIES[args.command];
  const mergedFlags: Readonly<Record<string, unknown>> = {
    ...args.flags,
    ...(args.forcedFlags ?? {}),
  };
  const normalizedReplayFlags = normalizeReplayFlags(mergedFlags, process.cwd());
  const replayArgs = buildReplayArgs({
    command: args.command,
    positional: args.positional,
    flags: normalizedReplayFlags,
    omitFlags: policy.omitFlags,
  });
  return writeReplayArtifact({
    outPath: args.outPath,
    command: args.command,
    positional: args.positional,
    flags: args.flags,
    replayArgs,
    result: args.result,
    meta: args.meta,
    extra: args.extra,
  });
}
