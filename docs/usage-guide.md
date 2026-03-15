# idlekit CLI Reference

Korean version: [usage-guide_ko.md](./usage-guide_ko.md)

Choose your entrypoint first:

1. Start your own game: [start-here-cli-designer.md](./start-here-cli-designer.md)
2. Study the canonical real-game example: [virtual-scenario-design.md](./virtual-scenario-design.md)
3. Learn the command loop: [tutorial-step-by-step.md](./tutorial-step-by-step.md)

## Environment

- Bun 1.3+
- repository workflow: `bun install`, `bun run typecheck`, `bun run test`, `bun run build`

## CLI modes

Development:

```bash
bun run --cwd packages/cli dev -- --help
```

Built output:

```bash
bun run --cwd packages/cli build
bun packages/cli/dist/main.js --help
```

Installed CLI:

```bash
bun add -g @idlekit/cli
idk --help
```

## Common commands

```bash
idk init scenario --wizard true --track personal --preset builder --out ./my-game-v1.json
idk validate <scenario>
idk simulate <scenario> --format json
idk experience <scenario> --format json
idk evaluate <scenario> --format md
idk review evaluate <scenario> --image-mode auto
idk review compare <a> <b>
idk compare <a> <b> --metric endNetWorth --format json
idk compare <a> <b> --bundle design --format json
idk compare <a> <b> --metric visibleChangesPerMinute --session-pattern short-bursts --days 7 --format json
idk tune <scenario> --tune <tunespec> --format json
idk ltv <scenario> --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --format json
idk doctor --format md
idk completions zsh
idk replay verify <artifact> --format json
```

## Design evaluation commands

- `experience`: session-pattern simulation, growth, milestones, and perceived progression
- `compare`: deterministic or design-facing A/B comparison
- `evaluate`: one-shot workflow for validate + simulate + experience + ltv
- `review evaluate`: interactive design dashboard built on top of `evaluate`
- `review compare`: interactive design comparison dashboard built on top of `compare`
- `tune`: strategy search against economy or experience-oriented objectives
- `ltv`: long-horizon monetization and value proxy estimation

## Completions and metadata

- `idk completions zsh|bash|fish|powershell`: emit shell completion script
- `idk complete -- <args...>`: dynamic completion protocol endpoint
- `idk doctor`: validate generated metadata, completions wiring, and Bun runtime assumptions

## More guides

- [scenario-and-tuning.md](./scenario-and-tuning.md)
- [plugin-and-adapter.md](./plugin-and-adapter.md)
- [testing.md](./testing.md)
