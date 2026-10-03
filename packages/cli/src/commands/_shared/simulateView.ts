export function resolveEventLog(args: {
  defaultEventLog:
    | Readonly<{
        enabled?: boolean;
        maxEvents?: number;
      }>
    | undefined;
  eventLogEnabled: boolean | undefined;
  eventLogMax: number | undefined;
}) {
  if (args.eventLogEnabled === undefined && args.eventLogMax === undefined) {
    return args.defaultEventLog;
  }
  return {
    enabled: args.eventLogEnabled ?? args.defaultEventLog?.enabled,
    maxEvents: args.eventLogMax ?? args.defaultEventLog?.maxEvents,
  };
}

type EventLogConfig = Readonly<{ enabled?: boolean; maxEvents?: number }> | undefined;

/**
 * Stage inputs for the event log a run keeps. The scenario hash covers its own event log, so a run
 * that keeps the same retention (enabled by default, no cap) adds nulls, like a run without flags.
 */
export function eventLogStageInputs(defaultEventLog: EventLogConfig, eventLog: EventLogConfig) {
  const keep = (log: EventLogConfig) => ({ enabled: log?.enabled ?? true, maxEvents: log?.maxEvents ?? null });
  const scenario = keep(defaultEventLog);
  const run = keep(eventLog);
  return scenario.enabled === run.enabled && scenario.maxEvents === run.maxEvents
    ? { eventLogEnabled: null, eventLogMax: null }
    : { eventLogEnabled: run.enabled, eventLogMax: run.maxEvents };
}

export function buildOfflineSummary(
  offlineRun:
    | Readonly<{
        offline: Readonly<{
          requestedSec: number;
          preDecaySec: number;
          effectiveSec: number;
          simulatedSec: number;
          stepSec: number;
          fullSteps: number;
          remainderSec: number;
          usedStrategy: boolean;
          overflow: unknown;
          decay: unknown;
        }>;
      }>
    | undefined,
) {
  return (
    offlineRun &&
    ({
      requestedSec: offlineRun.offline.requestedSec,
      preDecaySec: offlineRun.offline.preDecaySec,
      effectiveSec: offlineRun.offline.effectiveSec,
      simulatedSec: offlineRun.offline.simulatedSec,
      stepSec: offlineRun.offline.stepSec,
      fullSteps: offlineRun.offline.fullSteps,
      remainderSec: offlineRun.offline.remainderSec,
      usedStrategy: offlineRun.offline.usedStrategy,
      overflow: offlineRun.offline.overflow,
      decay: offlineRun.offline.decay,
    })
  );
}
