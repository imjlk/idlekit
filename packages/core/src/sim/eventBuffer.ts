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

/** The same rule as `eventLog.maxEvents`: an integer >= 0, or absent for no bound. */
export function assertLogBudget(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label} must be an integer >= 0`);
  }
}

/** Ring buffer for trace points or action rows. This is not a second event log. */
export function createBoundedLog<T>(maxItems: number | undefined, label = "bounded log size") {
  assertLogBudget(maxItems, label);
  const items: T[] = [];
  let totalSeen = 0;
  let dropped = 0;

  return {
    push(item: T): void {
      totalSeen += 1;
      if (maxItems === 0) {
        dropped += 1;
        return;
      }
      if (maxItems === undefined) {
        items.push(item);
        return;
      }
      if (items.length >= maxItems) {
        items.shift();
        dropped += 1;
      }
      items.push(item);
    },
    snapshot() {
      return {
        items,
        totalSeen,
        dropped,
        retained: items.length,
      };
    },
  };
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

    pushTimed(frames: readonly TimedSimEvent<N>[]): void {
      totalSeen += frames.length;
      if (!args.enabled || frames.length === 0) return;

      retainList(
        events,
        frames.map((frame) => frame.event),
        args.maxEvents,
        (count) => {
          dropped += count;
        },
      );
      retainList(eventTimeline, frames, args.maxEvents);
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
