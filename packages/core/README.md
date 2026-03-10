# @idlekit/core

Simulation and analysis primitives for idle game economy design. It compiles
scenarios, executes runs, evaluates long-horizon KPIs, and builds reports.

## Install

```bash
bun add @idlekit/core
```

Requires Bun `>=1.3.0`.

## Quick example

```ts
import { validateScenarioV1 } from "@idlekit/core";

const result = validateScenarioV1({
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "linear", version: 1 },
  initial: {
    wallet: { unit: "COIN", amount: "0" },
  },
  clock: { stepSec: 1, durationSec: 60 },
});

console.log(result.ok);
```

## Scope

- scenario validation / compilation
- simulation loop and `stepOnce`
- built-in strategies and tuning primitives
- ETA / growth / prestige / UX analysis
- report builders

## Runtime

`@idlekit/core` is maintained as a Bun-first ESM package.

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Scenario guide: [docs/scenario-and-tuning.md](https://github.com/imjlk/idlekit/blob/main/docs/scenario-and-tuning.md)
- Adapter pattern example: [examples/adapter-pattern](https://github.com/imjlk/idlekit/tree/main/examples/adapter-pattern)
