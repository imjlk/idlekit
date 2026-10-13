# Save and resume reset cycles

Run from the repository root after `bun install`:

```bash
bun examples/reset-cycle/save-resume.ts
```

The example earns one coin per second, keeps the wallet on reset, and gains one
prestige point every ten seconds. It saves a checkpoint after three simulation
steps to `tmp/reset-cycle-example/checkpoint.json`, reads the JSON back, and
recreates the scenario and stateless strategy before resuming. An optional first
argument chooses another checkpoint path.

The saved checkpoint has `nextIndex: 0`, `elapsedSec: 3`, `pendingSec: 3`, and
`pendingDurationSec: 10`. The pending cycle needs seven more seconds; it is not
a new ten-second cycle. For a fixed-interval policy, resume with
`cycles: totalCycles - checkpoint.nextIndex`: the pending cycle still counts as
one of the remaining cycles.

Expect `matchesContinuous: true` and a final summary of 30 elapsed seconds,
30 coins, three prestige points, and accumulated reset reward of three. The
three committed rows span `[0, 10]`, `[10, 20]`, and `[20, 30]`. The budget-cut
row has `resetAtSec: null`; its completed replacement comes from the resume, so
the example filters provisional rows when joining the cycle history.

The script compares the complete final checkpoints and committed rows. It also
checks the declared resume relation through the Core conformance helper, both
inside a cycle and at a cycle boundary. That relation is declared for this
constant-income fixture with a stateless strategy.

The number engine and JSON-compatible variables make plain JSON sufficient for
this example. Reusing the pattern with another engine requires its value codec;
stateful strategies or RNGs require their snapshot/restore hooks and matching
identities. A checkpoint is state, so recreate the same model, policy and
runtime components before resuming.
