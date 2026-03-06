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
