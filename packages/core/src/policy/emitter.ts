export type Emitter<E> = (events: readonly E[]) => void;

export function onType<E extends { type: string }, T extends E["type"]>(
  type: T,
  handler: (e: Extract<E, { type: T }>) => void,
): (events: readonly E[]) => void {
  return (events) => {
    for (const e of events) {
      if (e.type === type) {
        handler(e as Extract<E, { type: T }>);
      }
    }
  };
}

export function composeEmitters<E>(
  ...emitters: Array<((events: readonly E[]) => void) | undefined>
): (events: readonly E[]) => void {
  const list = emitters.filter(Boolean) as Array<(events: readonly E[]) => void>;
  return (events) => {
    for (const em of list) em(events);
  };
}
