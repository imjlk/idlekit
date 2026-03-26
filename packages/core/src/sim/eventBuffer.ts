import type { RunResult, SimEvent, TimedSimEvent } from "./types";

function retainList<T>(
  target: T[],
  batch: readonly T[],
  maxItems: number | undefined,
  onDrop?: (count: number) => void,
): void {
  if (batch.length === 0) return;

  if (maxItems === 0) {
    onDrop?.(batch.length);
    return;
  }

  if (maxItems === undefined) {
    target.push(...batch);
    return;
  }

  if (batch.length >= maxItems) {
    onDrop?.(target.length + (batch.length - maxItems));
    target.splice(0, target.length, ...batch.slice(batch.length - maxItems));
    return;
  }

  const overflow = Math.max(0, target.length + batch.length - maxItems);
  if (overflow > 0) {
    target.splice(0, overflow);
    onDrop?.(overflow);
  }
  target.push(...batch);
}

export function createEventBuffer<N>(args: {
  enabled: boolean;
  maxEvents?: number;
}) {
  const events: SimEvent<N>[] = [];
  const eventTimeline: TimedSimEvent<N>[] = [];
  let totalSeen = 0;
  let dropped = 0;

  return {
    pushBatch(batch: readonly SimEvent<N>[], t?: number): void {
      totalSeen += batch.length;
      if (!args.enabled || batch.length === 0) return;

      retainList(events, batch, args.maxEvents, (count) => {
        dropped += count;
      });

      if (t !== undefined) {
        retainList(
          eventTimeline,
          batch.map((event) => ({ t, event })),
          args.maxEvents,
        );
      }
    },

    pushRun<U extends string, Vars>(run: Pick<RunResult<N, U, Vars>, "events" | "eventTimeline" | "eventLog">): void {
      totalSeen += run.eventLog?.totalSeen ?? run.events.length;
      if (!args.enabled) return;

      dropped += run.eventLog?.dropped ?? 0;
      retainList(events, run.events, args.maxEvents, (count) => {
        dropped += count;
      });
      if (run.eventTimeline?.length) {
        retainList(eventTimeline, run.eventTimeline, args.maxEvents);
      }
    },

    snapshot() {
      return {
        events,
        eventTimeline: eventTimeline.length > 0 ? eventTimeline : undefined,
        eventLog: {
          enabled: args.enabled,
          maxEvents: args.maxEvents,
          totalSeen,
          dropped: args.enabled ? dropped : totalSeen,
          retained: events.length,
        },
      };
    },
  };
}
