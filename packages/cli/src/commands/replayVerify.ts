import { defineCommand, option } from "@bunli/core";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { cliError, errorDetail, replayArtifactInvalidError, usageError } from "../errors";
import { buildOutputMeta, stableStringify } from "../io/outputMeta";
import { canonicalizeReplayResult, hashReplayResult, type ReplayArtifactV1 } from "../io/replayArtifact";
import { writeOutput } from "../io/writeOutput";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_BUFFER = 256 * 1024 * 1024;

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function parseArtifact(input: unknown): ReplayArtifactV1 {
  const parsed = z
    .object({
      v: z.literal(1),
      kind: z.literal("idk.replay.artifact"),
      artifactVersion: z.literal(1),
      contractVersion: z.string().min(1),
      schemaRef: z.string().min(1),
      command: z.string().min(1),
      generatedAt: z.string().min(1),
      meta: z.record(z.string(), z.unknown()),
      input: z.object({
        positional: z.array(z.string()),
        flags: z.record(z.string(), z.unknown()),
      }),
      replay: z.object({
        args: z.array(z.string()).min(1),
        commandLine: z.string(),
        verify: z.object({
          runId: z.string().min(1),
          seed: z.number().finite(),
          scenarioHash: z.union([z.string(), z.record(z.string(), z.string())]),
          gitSha: z.string().min(1),
          pluginDigest: z.record(z.string(), z.string()),
          resultHash: z.string().min(1),
        }),
      }),
      result: z.unknown(),
    })
    .safeParse(input);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((x) => `${x.path.join(".") || "root"}: ${x.message}`)
      .join("; ");
    throw replayArtifactInvalidError("Invalid replay artifact.", detail);
  }

  return parsed.data as unknown as ReplayArtifactV1;
}

function runReplay(args: readonly string[]): unknown {
  const out = execFileSync("bun", ["src/main.ts", ...args], {
    cwd: CLI_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_BUFFER,
  });
  try {
    return JSON.parse(out);
  } catch (error) {
    throw replayArtifactInvalidError("Replay command did not return JSON.", errorDetail(error), error);
  }
}

export default defineCommand({
  name: "verify",
  description: "Verify replay artifact reproducibility",
  options: {
    strict: option(z.coerce.boolean().default(true), {
      description: "Exit with error if replay verification fails",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const artifactPath = positional[0];
    if (!artifactPath) {
      throw usageError("Usage: idk replay verify <artifact.json>");
    }

    const artifactAbs = resolve(process.cwd(), artifactPath);
    const raw = await readFile(artifactAbs, "utf8")
      .then((text) => {
        try {
          return JSON.parse(text);
        } catch (error) {
          throw replayArtifactInvalidError("Invalid replay artifact.", errorDetail(error), error);
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "CliError") throw error;
        throw replayArtifactInvalidError("Invalid replay artifact.", errorDetail(error), error);
      });
    const artifact = parseArtifact(raw);

    const requiredChecks = {
      runId: typeof artifact.replay.verify.runId === "string" && artifact.replay.verify.runId.length > 0,
      seed: typeof artifact.replay.verify.seed === "number" && Number.isFinite(artifact.replay.verify.seed),
      scenarioHash: artifact.replay.verify.scenarioHash !== undefined,
      gitSha: typeof artifact.replay.verify.gitSha === "string" && artifact.replay.verify.gitSha.length > 0,
      pluginDigest:
        artifact.replay.verify.pluginDigest !== undefined &&
        typeof artifact.replay.verify.pluginDigest === "object" &&
        !Array.isArray(artifact.replay.verify.pluginDigest),
      resultHash: typeof artifact.replay.verify.resultHash === "string" && artifact.replay.verify.resultHash.length > 0,
    };
    const missingFields = Object.entries(requiredChecks)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);

    const replayOutput = runReplay(artifact.replay.args);
    const expectedCanonical = canonicalizeReplayResult(artifact.result);
    const actualCanonical = canonicalizeReplayResult(replayOutput);
    const expectedHash = artifact.replay.verify.resultHash ?? hashReplayResult(expectedCanonical);
    const actualHash = hashReplayResult(actualCanonical);

    const replayMeta =
      replayOutput && typeof replayOutput === "object" && !Array.isArray(replayOutput)
        ? ((replayOutput as Record<string, unknown>)._meta as Record<string, unknown> | undefined)
        : undefined;

    const semanticChecks = {
      runId:
        replayMeta &&
        typeof replayMeta.runId === "string" &&
        replayMeta.runId === artifact.replay.verify.runId,
      seed:
        replayMeta &&
        typeof replayMeta.seed === "number" &&
        replayMeta.seed === artifact.replay.verify.seed,
      scenarioHash:
        replayMeta !== undefined &&
        deepEqual(replayMeta.scenarioHash, artifact.replay.verify.scenarioHash),
      gitSha:
        replayMeta &&
        typeof replayMeta.gitSha === "string" &&
        replayMeta.gitSha === artifact.replay.verify.gitSha,
      pluginDigest:
        replayMeta !== undefined &&
        deepEqual(replayMeta.pluginDigest, artifact.replay.verify.pluginDigest),
    };

    const drift = expectedHash !== actualHash;
    const pass =
      missingFields.length === 0 &&
      !drift &&
      Object.values(semanticChecks).every((x) => x === true);

    const output = {
      ok: pass,
      artifact: artifactAbs,
      command: artifact.command,
      replay: {
        commandLine: artifact.replay.commandLine,
        args: artifact.replay.args,
      },
      checks: {
        required: requiredChecks,
        semantic: semanticChecks,
      },
      missingFields,
      drift: {
        detected: drift,
        expectedHash,
        actualHash,
      },
    };

    if (!pass && flags.strict) {
      throw cliError(
        "REPLAY_ARTIFACT_INVALID",
        `Replay verification failed: missing=[${missingFields.join(",")}], drift=${drift}, semantic=${JSON.stringify(semanticChecks)}`,
      );
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
      meta: buildOutputMeta({
        command: "replay.verify",
      }),
    });
  },
});
