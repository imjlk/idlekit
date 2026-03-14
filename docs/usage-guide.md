# idlekit CLI Reference

Korean version: [usage-guide_ko.md](./usage-guide_ko.md)

Choose your entrypoint first:

1. Start your own game: [start-here-cli-designer.md](./start-here-cli-designer.md)
2. Learn the command loop: [tutorial-step-by-step.md](./tutorial-step-by-step.md)
3. Study a design example first: [virtual-scenario-design.md](./virtual-scenario-design.md)

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
idk validate <scenario>
idk simulate <scenario> --format json
idk experience <scenario> --format json
idk compare <a> <b> --metric endNetWorth --format json
idk compare <a> <b> --metric visibleChangesPerMinute --session-pattern short-bursts --days 7 --format json
idk tune <scenario> --tune <tunespec> --format json
idk ltv <scenario> --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --format json
idk replay verify <artifact> --format json
```

## Design evaluation commands

- `experience`: session-pattern simulation, growth, milestones, and perceived progression
- `compare`: deterministic or design-facing A/B comparison
- `tune`: strategy search against economy or experience-oriented objectives
- `ltv`: long-horizon monetization and value proxy estimation

## More guides

- [scenario-and-tuning.md](./scenario-and-tuning.md)
- [plugin-and-adapter.md](./plugin-and-adapter.md)
- [testing.md](./testing.md)
