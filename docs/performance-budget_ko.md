# 성능 예산

영문 원문: [performance-budget.md](./performance-budget.md)

`DX-04`는 simulate benchmark를 유지하고 compiler prepare와 simulation runtime을 나눈다. 느린 artifact는 어느 단계가 움직였는지 보여 준다. 성능 주장은 host와 corpus를 함께 적는다.

단계는 `install`, `prepare-cold`, `prepare-warm`, `check`, `build`, `runtime`이다. 첫 simulate 프로세스는 `prepare-cold`다. 첫 native plugin prepare가 그 시간에 포함된다. 다음 warmup 프로세스는 `prepare-warm`이다. 그 뒤 프로세스는 `runtime`이다. `stepsPerSec`는 workload 수를 runtime 중앙값의 초로 나눈다. prepare 시간은 그 비율에 넣지 않는다.

artifact 계약은 `idlekit.performance-budget`, schemaVersion 1이다. tools 기록이며 npm export가 아니다. config hash는 engine, seed, model, model version, step, trace, observer, worker, planner를 담는다. 같은 config의 artifact만 비교한다. full trace는 기본 채점 모드가 아니다. representative 시나리오는 [examples/bench/representative.json](../examples/bench/representative.json)이고 trace는 꺼져 있다.

지표는 total time median과 p95, steps/sec, planner expanded nodes와 nodes/sec, draws/sec, RSS와 heap delta, observation retained samples다. `allocPerStep`은 `unsupported`다. 없는 counter는 `absent`다. 측정된 0은 `measured` 0으로 남는다. planner node 수와 Monte Carlo draw 수는 호출자가 넘길 때만 기록한다. `tools/bench-planner.ts`와 `tools/bench-monte-carlo.ts`는 rollout이나 draw loop에 들어가지 않는다. worker `startupMs`와 `serializationMs`는 `absent`로 남는다.

hard gate는 최소 반복 수, 상대 느려짐, 절대 median 한도를 함께 쓴다. 반복이 충분하고 현재 median이 두 한도를 모두 넘을 때만 실패한다. 작은 절대 흔들림은 통과할 수 있다. 반복이 적으면 실패이며 통과가 아니다. config hash가 어긋나면 거절한다. gate는 새 baseline을 쓰지 않는다.

pull request CI는 representative 시나리오에 `bench:sim:check`를 실행한다. 긴 linear corpus는 [.github/workflows/performance-corpus.yml](../.github/workflows/performance-corpus.yml)의 `bench:sim:suite:check`가 실행한다. `kpi:report`와 `kpi:regress`는 경제 gate로 남는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 명령

```bash
bun run bench:sim
bun run bench:sim:check
bun run bench:planner -- --runtime-ms 100,200 --nodes 32 --workload 30
bun run bench:monte-carlo -- --runtime-ms 100,200 --draws 1000 --workload 30
bun run bench:sim:suite
bun run bench:sim:suite:check
```

`bench:sim:check`는 representative gate다. `bench:sim:suite:check`는 예약된 장기 corpus다. `--baseline`은 비교만 하고 파일을 다시 쓰지 않는다.

## 검증

아래 명령은 이 worktree에서 macOS arm64, Bun 1.4.2, ttsc 0.30.4로 실행했다. requirement 파일 sha256은 `dbe31ae0cdbeb5d919065a13f53145ddf3c42dea631e2b1334aa4ad44e17ef27`이다. `contracts:check`, `bench:sim:check`, `bench:sim:suite:check`는 미실행이다.

| 명령 | 종료 |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test tools/performanceBudget.test.ts` | 0 |
| `bun run runtime:check` | 0 |
| `bun tools/bench-planner.ts --runtime-ms 100,200 --nodes 32 --workload 30` | 0 |
| `bun tools/bench-monte-carlo.ts --runtime-ms 100,200 --draws 0 --workload 30` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |
| `bun run contracts:check` | 미실행 |
| `bun run bench:sim:check` | 미실행 |
| `bun run bench:sim:suite:check` | 미실행 |

`graph:check`는 `createPlannerStrategy`에서 `stepOnce`로 가는 edge를 미관측으로 두었고 hop은 0이다. 첫 `evidence:check`는 디스크가 cold plugin build를 끝내지 못해 종료 코드 2였다. 다음은 placeholder review 때문에 종료 코드 2였다. review를 고친 재실행은 종료 코드 0이다.
