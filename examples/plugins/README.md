# Plugin Example (Model + Strategy + Objective)

Korean version: [README_ko.md](./README_ko.md)

This example shows how to extend all three plugin surfaces at once:

- model: `plugin.generators@1`
- strategy: `plugin.producerFirst`
- objective: `plugin.gemsAndWorthLog10`

Files:

- `custom-econ-plugin.ts`
- `plugin-scenario.json`
- `plugin-tune.json`

## List registered entries

```bash
bun run --cwd packages/cli dev -- models list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- strategies list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- objectives list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
```

## Validate and simulate

```bash
bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true

bun run --cwd packages/cli dev -- simulate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

## Tune

```bash
bun run --cwd packages/cli dev -- tune ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --tune ../../examples/plugins/plugin-tune.json \
  --format json
```
