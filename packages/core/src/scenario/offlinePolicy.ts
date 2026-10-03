export type OfflineActionCategory = "buy" | "prestige" | "grant" | "custom";

export type OfflineActor = "player" | "automation";

/**
 * Opt-in offline action policy.
 * `legacy-all` is the previous session default: call the strategy.
 * `none` does not call `decide`.
 * `allow` keeps listed kinds, and listed actors when `actors` is set.
 */
export type OfflineActionPolicy =
  | Readonly<{ mode: "legacy-all" }>
  | Readonly<{ mode: "none" }>
  | Readonly<{
      mode: "allow";
      categories: readonly OfflineActionCategory[];
      actors?: readonly OfflineActor[];
    }>;

export type OfflinePolicy = Readonly<{
  maxSec?: number;
  overflowPolicy?: "clamp" | "reject";
  decay?: Readonly<{
    kind: "none" | "linear";
    /** Only used when kind is linear. 0..1 */
    floorRatio?: number;
  }>;
  actions?: OfflineActionPolicy;
}>;
