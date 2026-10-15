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

Canonical worked example built on this plugin:

- `../tutorials/14-orbital-foundry-v1.json`
- `../tutorials/15-orbital-foundry-compare-b.json`
- `../tutorials/16-orbital-foundry-tune.json`

Stable milestone keys emitted by this plugin model:

- `progress.first-upgrade`
- `progress.first-automation`
- `system.first-core`
- `system.fabricator-line-online`

## Run outside this repository

The plugin imports the public `@idlekit/core` package. It uses no repository source
path and needs no TypeScript compiler hook in an npm consumer.

In a new directory, install the packages with Bun 1.4.2 or newer available:

```sh
npm init -y
npm install @idlekit/core@^0.4.0 @idlekit/cli@^0.4.0
```

Copy `custom-econ-plugin.ts` and the three Orbital Foundry JSON files listed above
into that directory. Keep their names; the plugin and scenarios contain the same
registered model and strategy IDs. Run from that directory:

```sh
bun node_modules/@idlekit/cli/dist/main.js validate 14-orbital-foundry-v1.json --plugin ./custom-econ-plugin.ts --plugin-root . --allow-plugin true
bun node_modules/@idlekit/cli/dist/main.js review compare 14-orbital-foundry-v1.json 15-orbital-foundry-compare-b.json --bundle full --days 1 --draws 1 --seed 19 --plugin ./custom-econ-plugin.ts --plugin-root . --allow-plugin true
```

These are synthetic games. Compare modeled asset value, spendable cash, and pacing
under matched conditions; the example does not establish player retention or
revenue. The trust flags execute local code, so inspect the plugin first.
`bun run install:smoke` copies this original plugin unchanged into a package
consumer and simulates it against the packed Core and CLI.

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
