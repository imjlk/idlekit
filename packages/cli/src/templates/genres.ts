import cookieClicker from "./genres/cookie-clicker-v1.json" with { type: "json" };
import crafting from "./genres/crafting-v1.json" with { type: "json" };
import prestigeHeavy from "./genres/prestige-heavy-v1.json" with { type: "json" };
import sessionArcade from "./genres/session-arcade-v1.json" with { type: "json" };
import tycoon from "./genres/tycoon-v1.json" with { type: "json" };

/** Genre presets for `idk init scenario --preset <genre>`. Each one is a single scenario on a built-in model. */
export const GENRE_PRESETS = ["cookie-clicker", "tycoon", "prestige-heavy", "crafting", "session-arcade"] as const;
export type GenrePreset = (typeof GENRE_PRESETS)[number];

export type GenrePresetInfo = Readonly<{
  id: GenrePreset;
  model: "exponential" | "prestige" | "multi-currency" | "production-chain";
  summary: string;
  /** Path of the checked-in copy under the repository root, kept equal by `bun run templates:check`. */
  example: string;
}>;

const SOURCES: Readonly<Record<GenrePreset, unknown>> = {
  "cookie-clicker": cookieClicker,
  tycoon,
  "prestige-heavy": prestigeHeavy,
  crafting,
  "session-arcade": sessionArcade,
};

export const GENRE_PRESET_INFO: Readonly<Record<GenrePreset, GenrePresetInfo>> = {
  "cookie-clicker": {
    id: "cookie-clicker",
    model: "exponential",
    summary: "One fast-scaling generator with seeded golden-cookie drops, frenzy events, and lucky clicks",
    example: "examples/genres/cookie-clicker-v1.json",
  },
  tycoon: {
    id: "tycoon",
    model: "multi-currency",
    summary: "Several businesses, a capped premium currency, and a market that converts its overflow",
    example: "examples/genres/tycoon-v1.json",
  },
  "prestige-heavy": {
    id: "prestige-heavy",
    model: "prestige",
    summary: "Short runs with a scripted strategy that resets as soon as a reset is offered",
    example: "examples/genres/prestige-heavy-v1.json",
  },
  crafting: {
    id: "crafting",
    model: "production-chain",
    summary: "Gather, craft, and sell across five recipes with unlock gates and a storage cap",
    example: "examples/genres/crafting-v1.json",
  },
  "session-arcade": {
    id: "session-arcade",
    model: "exponential",
    summary: "A 30-minute arcade loop with frequent crits, bonus rounds, and a log soft cap",
    example: "examples/genres/session-arcade-v1.json",
  },
};

export function isGenrePreset(value: string | undefined): value is GenrePreset {
  return value !== undefined && (GENRE_PRESETS as readonly string[]).includes(value);
}

/** A fresh copy of the genre scenario. */
export function createGenreScenario(preset: GenrePreset): unknown {
  return structuredClone(SOURCES[preset]);
}
