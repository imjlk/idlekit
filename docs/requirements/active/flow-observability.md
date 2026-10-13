# Flow observability

## The flow adapter is optional {#req-pr15-flow-adapter}

Requirement `REQ-PR15-FLOW-ADAPTER`. `PR-15` owns it.

`flowOptionalAdapter` is `observer-not-required-model`. Flow samples are optional. `RunObserver.onFlow` records one sample and does nothing when the callback is absent. A model gains no required method. Resource names stay in the fixture. The same adapter covers logistics, crafting, and expedition-slot samples. The report contract is `idlekit.flow.v1`. The observation contract is `idlekit.flow.observation.v1`. `externalProvider` is false. The structural schema is `typia.json.schema<FlowReportV1, "3.1">()`. `validateFlowReport` is `typia.createValidate<FlowReportV1>()`. Seed `15` labels `examples/analysis/flow-pipeline.json`. Amounts, edge ratios, and Little's law inputs use the decimal wire spelling, with an optional sign and exponent, such as `1e2` or `+2.0E1`. `parseFlowObservation` rejects a value that is not a finite non-negative decimal instead of letting the diagnosis drop it.

The executed test is `declaresFlowAdapter` in `packages/core/src/sim/analysis/flow.test.ts`.

## A steady pipeline binds at the middle stage {#req-pr15-pipeline}

Requirement `REQ-PR15-PIPELINE`. `PR-15` owns it.

`flowPipelineConstraint` is `process-throughput-20`. A steady chain whose inflow is 100 per minute, whose middle stage throughput and capacity are 20 per minute, and whose sink capacity is 30 per minute with throughput 20 per minute, reports a process constraint. Final throughput stays 20 per minute. Doubling the inflow changes the queue and leaves final throughput at 20 per minute. A confirmed capacity constraint requires a causal model or experiment that names that saturated process. Without that causal record the same saturation is suspected. Saturation time uses the evidence window. Capacity, upstream throughput, and downstream capacity are read for the resource each edge names and inside the throughput sample's window. A sample of another resource or another window does not bind.

The executed test is `diagnosesSteadyPipeline` in `packages/core/src/sim/analysis/flow.test.ts`.

## Converted units stay apart {#req-pr15-conservation}

Requirement `REQ-PR15-CONSERVATION`. `PR-15` owns it.

`flowConservation` is `converted-units-stay-apart`. An edge with numerator 1, denominator 2, and loss 0.1 turns an inflow of 100 per minute into 45 per minute of the destination unit. Queue 40 plus unretained 5 matches that theoretical amount. The source unit is not added to the destination unit. A same-unit stock is not reported as a converted product. The source sample is read for the edge's source resource, and queue and unretained are read for its destination resource inside the source sample's window.

The executed test is `checksFlowConservation` in `packages/core/src/sim/analysis/flow.test.ts`.

## A model without flow observations is unsupported {#req-pr15-unsupported}

Requirement `REQ-PR15-UNSUPPORTED`. `PR-15` owns it.

`flowUnsupportedModel` is `no-invented-stall`. A model that does not observe flow is status `unsupported` and has no numeric facts. A growth regime, including stall, is not a flow sample and is not mapped to a capacity bottleneck. `stallMapped` stays false.

The executed test is `leavesUnknownModelsUnsupported` in `packages/core/src/sim/analysis/flow.test.ts`.

## Facts stay apart from the cause {#req-pr15-suspected}

Requirement `REQ-PR15-SUSPECTED`. `PR-15` owns it.

`flowSuspectedCause` is `facts-apart-from-cause`. When a throughput sample has no capacity, starved time, or blocked time, demand shortage and equipment shortage stay unresolved: status `insufficient-data` and claim `none`. Starved time without a capacity bind is a suspected material shortage. Blocked time without a capacity bind is a suspected demand shortage. Starved and blocked time are judged per process: each process gets its own hypothesis, and a process with both stays unresolved. Little's law applies only on a steady window with a defined work flow. It is not applied to ramp-up. A consistent Little's law result does not by itself confirm a cause. Facts and hypotheses are separate objects and link through evidence refs.

The executed test is `separatesFactsFromCauses` in `packages/core/src/sim/analysis/flow.test.ts`.
