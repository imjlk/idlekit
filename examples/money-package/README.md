# Money Package Example

Korean version: [README_ko.md](./README_ko.md)

This example runs `@idlekit/money` on its own, without the scenario compiler or CLI.

## Run

From the repository root:

```bash
bun examples/money-package/run.ts
```

## What it demonstrates

- `tickMoney` with `accumulate` policy (`queued` -> `flushed`)
- `formatMoney` / `parseMoney`
- `VisibilityTracker`
- `serializeMoneyState` / `deserializeMoneyState`

## See also

- Guide: [../../docs/money-library.md](../../docs/money-library.md)
- Custom engine adapter example: [../adapter-pattern/README.md](../adapter-pattern/README.md)
