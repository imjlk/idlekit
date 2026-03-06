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
  const replayArgs = buildReplayArgs({
    command: args.command,
    positional: args.positional,
    flags: {
      ...args.flags,
      ...(args.forcedFlags ?? {}),
    },
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
