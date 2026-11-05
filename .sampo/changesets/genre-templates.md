---
npm/@idlekit/cli: minor
---

Add genre presets to `idk init scenario --preset`: `cookie-clicker` (exponential with seeded drops and events), `tycoon` (multi-currency businesses), `prestige-heavy` (prestige with a scripted strategy that resets), `crafting` (multi-resource production chain), and `session-arcade` (short-session exponential loop). Each writes one scenario on a built-in model; `--wizard`, `--name`, and non-intro tracks are rejected with a genre preset. Copies live in `examples/genres/` with an English and Korean tutorial README, and `templates:check` keeps them equal to the CLI source.
