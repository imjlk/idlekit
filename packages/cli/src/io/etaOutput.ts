import type { EtaEstimateV1 } from "@idlekit/core";

/**
 * Legacy ETA JSON keeps numeric `seconds`. The analysis sibling may use null.
 * Readers must not treat a censored artifact as zero or as the legacy horizon.
 */
export function readEtaOutput(output: {
  readonly reached: boolean;
  readonly seconds: number;
  readonly mode: string;
  readonly analysis?: EtaEstimateV1;
}): Readonly<{
  reached: boolean;
  mode: string;
  legacySeconds: number;
  status?: EtaEstimateV1["status"];
  artifactSeconds: number | null;
}> {
  return {
    reached: output.reached,
    mode: output.mode,
    legacySeconds: output.seconds,
    ...(output.analysis ? { status: output.analysis.status } : {}),
    artifactSeconds: output.analysis ? output.analysis.seconds : null,
  };
}
