# @idlekit/cli

`idk` is the command-line interface for idle game design evaluation.
Use it to validate scenarios, run simulations, inspect pacing, compare variants, and tune strategies.
Official support in v1: Bun `>=1.3` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

```bash
bun add -g @idlekit/cli
```

Requires Bun `>=1.3.0`.

Typical flow:

<!-- snippet: snippets/readme/cli-quick-start.sh -->
```bash
idk init scenario --track personal --preset builder --out ./my-game-v1.json --name "Space Miner"
idk validate ./space-miner-v1.json
idk simulate ./space-miner-v1.json --format json
idk experience ./space-miner-v1.json --format json
idk evaluate ./space-miner-v1.json --format md
```

Interactive scaffold and review:

```bash
idk init scenario --wizard true --track personal --preset builder --out ./my-game-v1.json
idk review evaluate ./space-miner-v1.json --image-mode auto
idk review compare ./space-miner-v1.json ./space-miner-v1-compare-b.json
```

Shell completion and health check:

```bash
source <(idk completions zsh)
idk doctor --format md
```

Worked real-game example in this repository:

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/14-orbital-foundry-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --session-pattern twice-daily \
  --days 7 \
  --format json
```

## Runtime

`@idlekit/cli` is maintained as a Bun-first CLI package.

- automation path: `evaluate`, `compare --format json`, `experience --format md|json`
- human review path: `review evaluate`, `review compare`

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Product roadmap: [docs/roadmap.md](https://github.com/imjlk/idlekit/blob/main/docs/roadmap.md)
- Start here: [docs/start-here-cli-designer.md](https://github.com/imjlk/idlekit/blob/main/docs/start-here-cli-designer.md)
- Command reference: [docs/usage-guide.md](https://github.com/imjlk/idlekit/blob/main/docs/usage-guide.md)
