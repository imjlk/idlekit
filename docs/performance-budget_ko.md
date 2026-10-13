# 성능 예산

영문 원문: [performance-budget.md](./performance-budget.md)

`DX-04`는 simulate benchmark를 유지하고 compiler prepare와 simulation runtime을 나눈다. 느린 artifact는 어느 단계가 움직였는지 보여 준다. 성능 주장은 host와 corpus를 함께 적는다.

단계는 `install`, `prepare-cold`, `prepare-warm`, `check`, `build`, `runtime`이다. `tools/bench-sim.ts`에서 `prepare-cold`는 bench 프로세스 안의 첫 CLI ttsc bundle build(`packages/cli/scripts/cli-bundle.ts`)이고, `prepare-warm`은 그 build를 반복한다(`--prepare-warm`, 기본 1). 앞선 명령이 남긴 cache는 지우지 않으므로 cold는 이번 실행의 첫 prepare라는 뜻이다. warmup simulate 프로세스는 버린다. 측정한 simulate 프로세스가 `runtime`이다. `stepsPerSec`는 workload 수를 runtime 중앙값의 초로 나눈다. prepare 시간은 그 비율에 넣지 않는다.

artifact 계약은 `idlekit.performance-budget`, schemaVersion 1이다. tools 기록이며 npm export가 아니다. config hash는 engine, seed, model, model version, step, trace, observer, worker, planner를 담는다. artifact는 저장소 기준 상대 시나리오 경로와 `scenarioHash`도 기록한다. `scenarioHash`는 정규화한 시나리오 JSON의 sha256이며 duration, model params, strategy 입력을 담는다. 비교에는 같은 config, scenario hash, workload 수가 필요하다. 아니면 `workload-mismatch`다. trace 모드는 `outputs.report.traceEverySteps`를 읽는다. 주기가 1보다 크면 `bounded`다. full trace는 기본 채점 모드가 아니다. representative 시나리오는 [examples/bench/representative.json](../examples/bench/representative.json)이고 trace는 꺼져 있다.

지표는 total time median과 p95, steps/sec, planner expanded nodes와 nodes/sec, draws/sec, RSS와 heap delta, peak RSS, observation retained samples다. `allocPerStep`은 `unsupported`다. 없는 counter는 `absent`다. 측정된 0은 `measured` 0으로 남는다. planner node 수와 Monte Carlo draw 수는 호출자가 넘길 때만 기록한다. `tools/bench-planner.ts`와 `tools/bench-monte-carlo.ts`는 rollout이나 draw loop에 들어가지 않는다. worker `startupMs`와 `serializationMs`는 `absent`로 남는다. `tools/bench-sim.ts`는 측정한 simulate 자식 프로세스의 가장 큰 `maxRSS`를 `peakRssBytes`로 기록한다. harness 프로세스는 simulation을 실행하지 않으므로 RSS와 heap delta는 `absent`로 둔다. simulate 출력에 observation retention 수가 없으므로 observation retained samples도 `absent`로 둔다.

hard gate는 최소 반복 수, 상대 느려짐, 절대 median 한도를 함께 쓴다. 반복이 충분하고 현재 median이 두 한도를 모두 넘을 때만 실패한다. 작은 절대 흔들림은 통과할 수 있다. 반복이 적으면 실패이며 통과가 아니다. config hash가 어긋나면 거절한다. 정수 `iterations`가 1 이상이고 정수 `warmup`이 0 이상이 아닌 baseline은 읽지 않는다. gate는 새 baseline을 쓰지 않는다.

pull request CI는 representative 시나리오에 `bench:sim:check`를 실행한다. [examples/bench/perf-baseline.json](../examples/bench/perf-baseline.json)과 상대 느려짐 0.25, 절대 median 한도 250ms로 비교하고, 평균 500ms와 p95 900ms 한도도 함께 본다. baseline 파일은 측정한 host를 기록한다. `bun run bench:sim:baseline`이 그 파일을 다시 쓴다. gate는 쓰지 않는다. `bench:sim:suite:check`는 `--threshold-peak-rss-bytes`로 simulate 자식 프로세스마다 peak RSS도 제한한다. 긴 linear corpus는 [.github/workflows/performance-corpus.yml](../.github/workflows/performance-corpus.yml)의 `bench:sim:suite:check`가 실행한다. `kpi:report`와 `kpi:regress`는 경제 gate로 남는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 명령

```bash
bun run bench:sim
bun run bench:sim:check
bun run bench:sim:baseline
bun run bench:planner -- --runtime-ms 100,200 --nodes 32 --workload 30
bun run bench:monte-carlo -- --runtime-ms 100,200 --draws 1000 --workload 30
bun run bench:sim:suite
bun run bench:sim:suite:check
```

`bench:sim:check`는 representative gate다. `bench:sim:suite:check`는 예약된 장기 corpus다. `--baseline`은 artifact 하나나 `bench-sim --out` 결과를 읽고, 시나리오마다 같은 scenario hash의 항목과 비교하며, 파일을 다시 쓰지 않는다.

## 검증

아래 명령은 이 worktree에서 macOS arm64, Bun 1.4.2, ttsc 0.30.4로 실행했다. requirement 파일 sha256은 `fd4a8a791119ff8fb866bd63d273bccb207c86a5d77226a60fa6a6e93b9d9ad5`이다. `contracts:check`는 미실행이다. `bench:sim:check`와 `bench:sim:suite:check`는 CI runner가 아닌 이 macOS host에서 실행했다.

| 명령 | 종료 |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test tools/performanceBudget.test.ts` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/bench-planner.ts --runtime-ms 100,200 --nodes 32 --workload 30` | 0 |
| `bun tools/bench-monte-carlo.ts --runtime-ms 100,200 --draws 0 --workload 30` | 0 |
| `bun run typecheck` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |
| `bun run docs:verify:quick` | 0 |
| `bun run contracts:check` | 미실행 |
| `bun run bench:sim:check` | 0 |
| `bun run bench:sim:suite:check` | 0 |

`graph:check`는 `createPlannerStrategy`에서 `stepOnce`로 가는 edge를 미관측으로 두었고 hop은 0이다. 첫 `evidence:check`는 디스크가 cold plugin build를 끝내지 못해 종료 코드 2였다. 다음은 placeholder review 때문에 종료 코드 2였다. review를 고친 재실행은 종료 코드 0이다.
