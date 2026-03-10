# Adapter Pattern Example

Korean version: [README_ko.md](./README_ko.md)

This example shows how to connect a custom fixed-point `bigint` engine to the
simulator through the `Engine<N>` adapter contract.

Files:

- `fixedPointEngine.ts`: `Engine<bigint>` implementation
- `run.ts`: custom engine + model + built-in greedy strategy simulation

## Run

From the repository root:

```bash
bun examples/adapter-pattern/run.ts
```

Expected output shape:

```text
Adapter pattern example completed
- End time: 120s
- End money: ...
- End netWorth: ...
- Owned generators: ...
- Actions applied: ...
```

## What matters

- the simulator is not tied to `number`
- payment / accumulation logic stays behind the engine adapter
- strategies and simulation code remain reusable across numeric backends

## Practical notes

- very large idle-game scales depend on a solid `absLog10` implementation
- use `toNumber` only for heuristics and UI-friendly summaries
- if precision is critical, avoid float round-trips inside `mul` / `div`
