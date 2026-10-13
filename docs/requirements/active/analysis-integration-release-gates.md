# Analysis integration release gates

## The release matrix has hand answers {#req-pr20-integration-matrix}

Requirement `REQ-PR20-INTEGRATION-MATRIX`. `PR-20` owns it.

`integrationReleaseScope` is `selected-optional-tracks`. Flow observation, guarded analytic advance, the Jev provider, and the worker backend are in this tree as optional capabilities. They are not the default command path. They are optional at run time, not optional in the release check: `tools/publish-gate.ts` runs the repository-wide `typecheck`, `test`, and `build`, which include their sources and tests, so a failure in any of them blocks publication. `integrationUnsupportedEngine` is `breakEternity`. That engine is not a supported product feature.

`integrationHandAnswer` is `integer-income-times-duration`. Constant income end money is initial plus income per second times the seconds that actually run, including a shorter final tick when the duration is off the step grid. That case is the declared `checkPartialFinalTick` relation in the conformance harness, run over the seed corpus by `replaysPartialFinalTickAcrossTheSeedCorpus`. A session budget uses `maxSteps` instead of the longer duration. A quoted bulk buy pays the quote total once. A reset carry wallet is the declared post-reset wallet, and the reward delta is the declared point gain. The carry wallet must differ in value from the pre-reset wallet, so `01` against `1` is refused. A goal that is still short at the duration ends `unreached`. Offline policy is recorded and does not change that fixed-step total. Event retention distinguishes off, capped, and full. Two fresh scripted runs start at cursor 0. Seed label is `19`. This change does not publish to npm.

The executed tests are `checksIntegrationMatrix` in `packages/core/src/sim/integrationMatrix.test.ts` and `replaysPartialFinalTickAcrossTheSeedCorpus` in `packages/core/src/testkit/conformance.test.ts`.
