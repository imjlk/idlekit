# @idlekit/cli

`idk` is the command-line interface for validating scenarios, running simulations,
evaluating experience and pacing, comparing balance variants, tuning strategies, and generating reports.

## Install

```bash
bun add -g @idlekit/cli
```

Requires Bun `>=1.3.0`.

## Quick start

```bash
idk validate ./my-game-v1.json
idk simulate ./my-game-v1.json --format json
idk experience ./my-game-v1.json --format json
idk ltv ./my-game-v1.json --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --format json
```

To generate a starter bundle from the repository checkout:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json --name "Space Miner"
```

## Runtime

`@idlekit/cli` is maintained as a Bun-first CLI package.

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Start here: [docs/start-here-cli-designer.md](https://github.com/imjlk/idlekit/blob/main/docs/start-here-cli-designer.md)
- Command reference: [docs/usage-guide.md](https://github.com/imjlk/idlekit/blob/main/docs/usage-guide.md)
