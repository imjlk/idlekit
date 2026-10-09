import type { CompiledScenario } from "@idlekit/core";

type FastMode = CompiledScenario<number, string, Record<string, unknown>>["run"]["fast"];

/** Omission inherits the scenario; an explicit boolean overrides it. */
export function resolveFastMode(requested: boolean | undefined, inherited: FastMode): FastMode {
  if (requested === undefined) return inherited;
  return requested
    ? { enabled: true, kind: "log-domain", disableMoneyEvents: true }
    : { enabled: false };
}
