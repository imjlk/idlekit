---
npm/@idlekit/core: minor
npm/@idlekit/cli: minor
---

Add a telemetry feedback loop on standardized cohort batches. `@idlekit/core` adds `validateCohortBatch`, `observeCohortBatch`, `compareCohorts`, `twoProportionSignificance`, `detectRetentionDrift`, `planScenarioRetentionUpdate`, `planRetentionExperiment` and `assignExperimentGroup`. The CLI adds `idk telemetry validate|compare|drift|patch|experiment`: multi-cohort comparison with significance hints, drift alerts that exit 2 with `--fail-on-drift`, an observe → patch → validate → re-run `ltv` workflow with a before/after LTV and pacing diff (exit 3 when no patch is ready), and retention A/B sample-size and observation-window planning. `idk calibrate --cohort` reads one cohort from a batch. The batch input schema is `docs/schemas/cohort-batch.v1.schema.json`; monitoring examples and an anonymization guide are in `docs/player-telemetry.md`.
