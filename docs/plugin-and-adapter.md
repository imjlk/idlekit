# Plugin and Adapter Guide

Korean version: [plugin-and-adapter_ko.md](./plugin-and-adapter_ko.md)

This guide covers two extension points:

- CLI plugins that contribute models, strategies, and objectives
- `Engine<N>` adapters that let you plug in a custom numeric backend

## Plugin module shape

A CLI plugin can export any combination of `models`, `strategies`, and `objectives`.

```ts
import type { ModelFactory, ObjectiveFactory, StrategyFactory } from "@idlekit/core";

const plugin: {
  models?: readonly ModelFactory[];
  strategies?: readonly StrategyFactory[];
  objectives?: readonly ObjectiveFactory[];
} = {
  models: [],
  strategies: [],
  objectives: [],
};

export default plugin;
```

Named exports are also supported.

## Loading a plugin

```bash
bun run --cwd packages/cli dev -- models list --plugin ./my-plugin.ts --allow-plugin true
```

Recommended secure loading:

```bash
SHA=$(shasum -a 256 ./my-plugin.ts | awk '{print $1}')
bun run --cwd packages/cli dev -- models list \
  --plugin ./my-plugin.ts \
  --allow-plugin true \
  --plugin-root . \
  --plugin-sha256 ./my-plugin.ts=$SHA
```

Canonical worked example using the bundled plugin:

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/14-orbital-foundry-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --session-pattern twice-daily \
  --days 7 \
  --format json
```

## Engine adapters

`@idlekit/money` and `@idlekit/core` use the `Engine<N>` interface to abstract numeric backends.
That lets you switch between `number`, `break_infinity.js`, or your own fixed-point / bigint engine.

Use the adapter example to see a custom `Engine<bigint>` wired into the simulator:

- [../examples/adapter-pattern/README.md](../examples/adapter-pattern/README.md)
- [../examples/plugins/README.md](../examples/plugins/README.md)
