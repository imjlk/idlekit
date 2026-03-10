# @idlekit/cli

`idk` is the command-line interface for validating scenarios, running simulations,
comparing balance variants, tuning strategies, and generating reports.

## Install

```bash
bun add -g @idlekit/cli
```

## Quick start

```bash
idk validate examples/tutorials/11-my-game-v1.json
idk simulate examples/tutorials/11-my-game-v1.json --format json
idk ltv examples/tutorials/11-my-game-v1.json --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --format json
```

## Runtime

`@idlekit/cli` is maintained as a Bun-first CLI package.

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Start here: [docs/start-here-cli-designer.md](https://github.com/imjlk/idlekit/blob/main/docs/start-here-cli-designer.md)
- Command reference: [docs/usage-guide.md](https://github.com/imjlk/idlekit/blob/main/docs/usage-guide.md)
