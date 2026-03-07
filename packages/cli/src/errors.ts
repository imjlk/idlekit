import type { SimStateError, StandardIssue } from "@idlekit/core";

export type CliErrorCode =
  | "CLI_USAGE"
  | "CLI_FLAG_UNSUPPORTED_FOR_TRACK"
  | "SCENARIO_INVALID"
  | "SCENARIO_READ_FAILED"
  | "TUNE_SPEC_INVALID"
  | "UNKNOWN_STRATEGY"
  | "PLUGIN_DISABLED"
  | "PLUGIN_POLICY_VIOLATION"
  | "SIM_STATE_INVALID_JSON"
  | "SIM_STATE_UNSUPPORTED_VERSION"
  | "SIM_STATE_UNIT_MISMATCH"
  | "RESUME_STRATEGY_MISMATCH"
  | "REPLAY_ARTIFACT_INVALID"
  | "OUTPUT_META_INVALID"
  | "INTERNAL_ERROR";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly hint?: string;
  readonly detail?: string;

  constructor(
    code: CliErrorCode,
    message: string,
    opts?: {
      hint?: string;
      detail?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts?.cause });
    this.name = "CliError";
    this.code = code;
    this.hint = opts?.hint;
    this.detail = opts?.detail;
  }
}

function formatIssues(issues: readonly StandardIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path ? `${issue.path}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

export function cliError(
  code: CliErrorCode,
  message: string,
  opts?: {
    hint?: string;
    detail?: string;
    cause?: unknown;
  },
): CliError {
  return new CliError(code, message, opts);
}

export function usageError(message: string, hint?: string): CliError {
  return cliError("CLI_USAGE", message, { hint });
}

export function unsupportedFlagForTrackError(flag: string, track: string): CliError {
  return cliError("CLI_FLAG_UNSUPPORTED_FOR_TRACK", `Flag '${flag}' is not supported for track '${track}'.`, {
    hint: "Use --name only with --track personal.",
  });
}

export function scenarioInvalidError(issues: readonly StandardIssue[], label?: string): CliError {
  return cliError("SCENARIO_INVALID", `${label ? `Scenario ${label} invalid` : "Scenario invalid"}.`, {
    detail: formatIssues(issues),
  });
}

export function tuneSpecInvalidError(issues: readonly StandardIssue[]): CliError {
  return cliError("TUNE_SPEC_INVALID", "Tune spec invalid.", {
    detail: formatIssues(issues),
  });
}

export function unknownStrategyError(id: string): CliError {
  return cliError("UNKNOWN_STRATEGY", `Unknown strategy: ${id}`);
}

export function resumeStrategyMismatchError(message: string): CliError {
  return cliError("RESUME_STRATEGY_MISMATCH", message);
}

export function scenarioReadFailedError(path: string, cause: unknown): CliError {
  return cliError("SCENARIO_READ_FAILED", `Unable to read scenario file: ${path}`, {
    detail: errorDetail(cause),
    cause,
  });
}

export function replayArtifactInvalidError(message: string, detail?: string, cause?: unknown): CliError {
  return cliError("REPLAY_ARTIFACT_INVALID", message, {
    detail,
    cause,
  });
}

export function outputMetaInvalidError(message: string, cause?: unknown): CliError {
  return cliError("OUTPUT_META_INVALID", message, {
    cause,
  });
}

export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isSimStateError(error: unknown): error is SimStateError {
  return error instanceof Error && error.name === "SimStateError" && typeof (error as { code?: unknown }).code === "string";
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;

  if (error instanceof Error && error.cause) {
    const cause = error.cause;
    if (cause instanceof CliError || isSimStateError(cause)) {
      return toCliError(cause);
    }
  }

  if (isSimStateError(error)) {
    const simError = error as SimStateError & { code: CliErrorCode };
    return cliError(simError.code, simError.message, { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (name === "SchemaError" || name === "OptionValidationError" || name === "CommandNotFoundError") {
    return cliError("CLI_USAGE", message, { cause: error });
  }

  if (message.startsWith("Plugin loading is disabled")) {
    return cliError("PLUGIN_DISABLED", message, {
      hint: "Pass --allow-plugin true and restrict loading with --plugin-root/--plugin-sha256/--plugin-trust-file.",
      cause: error,
    });
  }

  if (
    message.includes("plugin") &&
    (message.includes("sha256") ||
      message.includes("trust file") ||
      message.includes("allowed roots") ||
      message.includes("local file path") ||
      message.includes("extension") ||
      message.includes("not found"))
  ) {
    return cliError("PLUGIN_POLICY_VIOLATION", message, { cause: error });
  }

  if (message.startsWith("Unknown strategy:")) {
    return cliError("UNKNOWN_STRATEGY", message, { cause: error });
  }

  if (message.startsWith("Resume strategy") || message.startsWith("Resume state contains strategy") || message.includes("does not support state restore")) {
    return cliError("RESUME_STRATEGY_MISMATCH", message, { cause: error });
  }

  if (message.startsWith("Invalid replay artifact:") || message.startsWith("Replay artifact requires") || message.startsWith("Replay verification failed") || message.startsWith("Replay command did not return JSON")) {
    return cliError("REPLAY_ARTIFACT_INVALID", message, { cause: error });
  }

  if (message.startsWith("Invalid output meta:")) {
    return cliError("OUTPUT_META_INVALID", message, { cause: error });
  }

  if (message.startsWith("Scenario invalid") || message.startsWith("Scenario A invalid") || message.startsWith("Scenario B invalid")) {
    return cliError("SCENARIO_INVALID", message, { cause: error });
  }

  if (message.startsWith("Tune spec invalid")) {
    return cliError("TUNE_SPEC_INVALID", message, { cause: error });
  }

  if (message.startsWith("Usage:")) {
    return cliError("CLI_USAGE", message, { cause: error });
  }

  if (message.includes("not found") || message.includes("cannot be executed directly")) {
    return cliError("CLI_USAGE", message, { cause: error });
  }

  return cliError("INTERNAL_ERROR", message, { cause: error });
}

export function formatCliError(error: CliError): string {
  const lines = [`[${error.code}] ${error.message}`];
  if (error.hint) lines.push(`Hint: ${error.hint}`);
  if (error.detail) lines.push(`Detail: ${error.detail}`);
  if (process.env.IDK_DEBUG_ERRORS === "1" && error.stack) {
    lines.push(error.stack);
  }
  return lines.join("\n");
}
