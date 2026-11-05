import { z } from "zod";

/*
 * Seeded stochastic income events: critical ticks, random drops, and timed events.
 *
 * Every draw is a pure function of (seed, stream, index). Nothing is carried in state, so a planner
 * preview, a resumed run, and a fresh run that reach the same tick read the same outcome, and a
 * Monte Carlo draw changes only through its seed. `Math.random` is never read.
 */

const streamId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,47}$/, "must start with a lowercase letter and use only a-z, 0-9, '_' or '-'");

export const stochasticCritSchema = z.object({
  /** Probability that one tick's income is a critical tick. */
  chance: z.number().finite().min(0).max(1),
  /** Income multiplier of a critical tick. */
  multiplier: z.number().finite().min(1),
});

export const stochasticDropSchema = z.object({
  id: streamId,
  /** Poisson rate of the drop per second of simulated time. A tick of `dt` seconds fires with 1 - exp(-rate * dt). */
  ratePerSec: z.number().finite().positive(),
  /** Reward of one drop, in seconds of the tick's base income (a "golden cookie" worth 60 s of production is 60). */
  rewardIncomeSec: z.number().finite().positive(),
});

export const stochasticEventSchema = z
  .object({
    id: streamId,
    /** Length of one event window. Each window rolls once. */
    windowSec: z.number().finite().positive(),
    /** Probability that the event runs in a window. */
    chance: z.number().finite().min(0).max(1),
    /** Seconds the event lasts from the start of its window. */
    durationSec: z.number().finite().positive(),
    /** Income multiplier while the event runs. */
    incomeMultiplier: z.number().finite().positive(),
  })
  .refine((event) => event.durationSec <= event.windowSec, "durationSec must be <= windowSec");

export const stochasticSpecSchema = z
  .object({
    crit: stochasticCritSchema.optional(),
    drops: z.array(stochasticDropSchema).max(16).default([]),
    events: z.array(stochasticEventSchema).max(16).default([]),
  })
  .refine((spec) => uniqueIds(spec.drops) && uniqueIds(spec.events), "drop ids and event ids must be unique");

export type StochasticSpec = z.output<typeof stochasticSpecSchema>;
export type StochasticSpecInput = z.input<typeof stochasticSpecSchema>;

function uniqueIds(rows: readonly Readonly<{ id: string }>[]): boolean {
  return new Set(rows.map((row) => row.id)).size === rows.length;
}

export function parseStochasticSpec(raw: unknown): StochasticSpec {
  return stochasticSpecSchema.parse(raw ?? {});
}

/** True when the spec can change any tick's income. */
export function stochasticSpecActive(spec: StochasticSpec | undefined): spec is StochasticSpec {
  if (!spec) return false;
  return (spec.crit !== undefined && spec.crit.chance > 0) || spec.drops.length > 0 || spec.events.some((event) => event.chance > 0);
}

/** FNV-1a 32-bit hash of a stream label. */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 32-bit finalizer (murmur3 fmix32). */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Uniform [0, 1) for one (seed, stream, index). The index may exceed 2^32: its high and low words are mixed separately.
 * A non-finite seed reads as 0, the runner's default seed.
 */
export function stochasticUniform(seed: number, stream: string, index: number): number {
  const base = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  const idx = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  const low = idx >>> 0;
  const high = Math.floor(idx / 4294967296) >>> 0;
  let h = mix32(base ^ hashLabel(stream));
  h = mix32(h ^ Math.imul(low, 0x9e3779b1));
  h = mix32(h ^ Math.imul(high + 1, 0x85ebca77));
  return h / 4294967296;
}

export type StochasticTickOutcome = Readonly<{
  /** Multiplier on the tick's base income (crit times running events). */
  multiplier: number;
  /** Extra income in seconds of base income granted this tick by drops. */
  bonusIncomeSec: number;
  crit: boolean;
  drops: readonly string[];
  events: readonly string[];
}>;

/**
 * Outcome of the tick that starts at `t` and lasts `dt` seconds.
 * The tick index is `round(t / dt)`, so a tick reached through preview, resume, or a fresh run reads the same draw.
 */
export function stochasticTickOutcome(spec: StochasticSpec, seed: number, t: number, dt: number): StochasticTickOutcome {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 1;
  const time = Number.isFinite(t) && t > 0 ? t : 0;
  const tick = Math.round(time / step);
  let multiplier = 1;
  let crit = false;
  if (spec.crit && spec.crit.chance > 0 && stochasticUniform(seed, "crit", tick) < spec.crit.chance) {
    crit = true;
    multiplier *= spec.crit.multiplier;
  }
  const events: string[] = [];
  for (const event of spec.events) {
    if (event.chance <= 0) continue;
    const window = Math.floor(time / event.windowSec);
    const into = time - window * event.windowSec;
    if (into < event.durationSec && stochasticUniform(seed, `event:${event.id}`, window) < event.chance) {
      events.push(event.id);
      multiplier *= event.incomeMultiplier;
    }
  }
  const drops: string[] = [];
  let bonusIncomeSec = 0;
  for (const drop of spec.drops) {
    const p = 1 - Math.exp(-drop.ratePerSec * step);
    if (stochasticUniform(seed, `drop:${drop.id}`, tick) < p) {
      drops.push(drop.id);
      bonusIncomeSec += drop.rewardIncomeSec;
    }
  }
  return { multiplier, bonusIncomeSec, crit, drops, events };
}

/**
 * Factor on per-second base income for this tick: `multiplier + bonusIncomeSec / dt`.
 * A drop's reward arrives as income over the tick, so the wallet and tick policy see it like any other income.
 */
export function stochasticIncomeFactor(spec: StochasticSpec, seed: number, t: number, dt: number): number {
  const outcome = stochasticTickOutcome(spec, seed, t, dt);
  const step = Number.isFinite(dt) && dt > 0 ? dt : 1;
  return outcome.multiplier + outcome.bonusIncomeSec / step;
}

/**
 * Long-run mean of `stochasticIncomeFactor` for a step of `dt`. Events and crits are treated as independent.
 * A design-time check: a draw-averaged Monte Carlo income should approach base income times this factor.
 */
export function expectedStochasticIncomeFactor(spec: StochasticSpec, dt: number): number {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 1;
  let factor = spec.crit ? 1 + spec.crit.chance * (spec.crit.multiplier - 1) : 1;
  for (const event of spec.events) {
    const share = event.chance * (event.durationSec / event.windowSec);
    factor *= 1 + share * (event.incomeMultiplier - 1);
  }
  let bonus = 0;
  for (const drop of spec.drops) bonus += (1 - Math.exp(-drop.ratePerSec * step)) * drop.rewardIncomeSec;
  return factor + bonus / step;
}

export type StochasticOutcomeCounts = Readonly<{
  ticks: number;
  crits: number;
  drops: Readonly<Record<string, number>>;
  eventTicks: Readonly<Record<string, number>>;
  meanFactor: number;
}>;

/** Count the outcomes of `ticks` consecutive ticks from `startT`. For reports and tests; the runner does not call it. */
export function countStochasticOutcomes(
  spec: StochasticSpec,
  seed: number,
  args: Readonly<{ startT?: number; dt: number; ticks: number }>,
): StochasticOutcomeCounts {
  const ticks = Math.max(0, Math.floor(args.ticks));
  if (ticks > 10_000_000) throw new RangeError("countStochasticOutcomes ticks must be <= 10000000");
  const drops: Record<string, number> = Object.fromEntries(spec.drops.map((drop) => [drop.id, 0]));
  const eventTicks: Record<string, number> = Object.fromEntries(spec.events.map((event) => [event.id, 0]));
  let crits = 0;
  let factorSum = 0;
  const start = args.startT ?? 0;
  for (let i = 0; i < ticks; i += 1) {
    const t = start + i * args.dt;
    const outcome = stochasticTickOutcome(spec, seed, t, args.dt);
    if (outcome.crit) crits += 1;
    for (const id of outcome.drops) drops[id] = (drops[id] ?? 0) + 1;
    for (const id of outcome.events) eventTicks[id] = (eventTicks[id] ?? 0) + 1;
    factorSum += outcome.multiplier + outcome.bonusIncomeSec / args.dt;
  }
  return { ticks, crits, drops, eventTicks, meanFactor: ticks > 0 ? factorSum / ticks : 1 };
}
