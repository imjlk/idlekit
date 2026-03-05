import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import { formatMoney, type FormatMoneyOptions } from "./formatMoney";

export type VisibilityChange = Readonly<{
  changed: boolean;
  current: string;
  previous?: string;
}>;

export class VisibilityTracker<N, U extends string> {
  #previous?: string;

  constructor(
    private readonly E: Engine<N>,
    private readonly opts?: FormatMoneyOptions,
  ) {}

  observe(money: Money<N, U>): VisibilityChange {
    const current = formatMoney(this.E, money, this.opts);
    const previous = this.#previous;
    const changed = previous !== undefined && previous !== current;
    this.#previous = current;
    return { changed, current, previous };
  }

  current(): string | undefined {
    return this.#previous;
  }

  reset(): void {
    this.#previous = undefined;
  }
}
