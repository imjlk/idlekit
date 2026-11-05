---
npm/@idlekit/core: minor
npm/@idlekit/cli: minor
---

Add game engine integration. `idk export engine --target generic|godot|unity` writes an engine-neutral `idlekit.engine-params` document, a Godot 4 `.tres` resource or JSON, or Unity JSON and CSV, with a level table computed by the model. `idk import scenario --mapping` turns CSV, JSON, or YAML economy tables into a validated `ScenarioV1`, with unit suffixes, time-unit conversion, and geometric or linear curve fits; an engine-params document imports without a mapping. `idk verify runtime` compares a game's own income and cost functions, exported by a plugin as `runtimes` (`RuntimeEconomyAdapter` in `@idlekit/core`), with the idlekit simulation on the same states and a fixed seed, and reports every difference. Schemas live in `docs/schemas`, and `examples/engine-integration` has Godot, Unity, import, and TypeScript runtime examples.
