# Design study

Korean version: [README_ko.md](./README_ko.md)

`forge-study.json` is a design-study spec for [`26-exponential-forge-v1.json`](../tutorials/26-exponential-forge-v1.json). It varies `costGrowth`, `growthRate`, and `costBase` (log scale), and scores the time to the first milestone, short-burst session pacing, and end net worth.

```bash
bun run --cwd packages/cli dev -- sensitivity ../../examples/tutorials/26-exponential-forge-v1.json --spec ../../examples/design-study/forge-study.json --method morris --max-runs 40 --format md
bun run --cwd packages/cli dev -- optimize ../../examples/tutorials/26-exponential-forge-v1.json --spec ../../examples/design-study/forge-study.json --method ga --max-runs 60 --write-best /tmp/forge-best.json --format md
```

The spec format is in [Advanced analysis](../../docs/advanced-analysis.md#design-study-spec).
