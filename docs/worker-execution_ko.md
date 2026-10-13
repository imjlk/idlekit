# 워커 실행 backend

영문 원문: [worker-execution.md](./worker-execution.md)

`DX-05`는 독립 분석 trial을 위한 선택적 Bun worker pool을 더한다. core 계약은 batch 제출, 취소, 예산만 가진다. `Bun.Worker`, 파일, 네트워크는 CLI adapter에 있다. 기본 선택은 `local-default`다. worker를 쓰려면 호출자가 개수를 명시한다. 이번 릴리스의 `idk` 명령은 pool을 선택하지 않는다. pool은 CLI 패키지 안의 내부 adapter이고, 명령에 연결하는 일은 이후 작업이다. DX-04에 작은 분석 batch가 worker에서 더 싸다는 실측이 없으므로 이 변경은 pool을 자동 선택하지 않는다.

task는 버전 있는 JSON descriptor다. 시나리오 매개변수, logical index, seed, step budget, engine id, plugin 경로, root, digest 목록을 담는다. worker는 신뢰된 linear factory와 기존 serde로 fresh run을 다시 만든다. plugin 경로가 없는 trial은 내장 registry로 실행된다. worker entry가 CLI plugin loader를 trial에 넘기고, plugin 경로가 있는데 loader가 없으면 `plugin-trust`로 닫힌 채 실패한다. compiled closure, 함수, native decimal 인스턴스는 받지 않는다. draw seed는 `logicalDrawSeed(base, logicalIndex)`다. worker 수와 완료 순서는 seed 입력이 아니다. 재현 라벨은 `19`다.

결과는 logical index로 정렬한 뒤 금액을 더한다. 합은 정확한 십진 문자열 합이고, break-infinity 금액이 쓰는 과학 표기 serde 문자열도 받는다. 완료 순서는 덧셈 순서가 아니다. `fullDistribution`은 모든 outcome이 `ok`일 때만 참이다. abort는 `cancelled`다. timeout과 queue bound는 `incomplete`다. `taskTimeoutMs`는 두 backend 모두 task마다의 창이고 batch 전체 마감은 없다. step budget이 horizon 전에 멈춘 trial은 `incomplete`다. 재시도는 같은 task id와 seed를 유지하고 횟수 제한이 있으며 `plugin-trust`는 재시도하지 않는다. 예외를 던진 local trial과 worker가 보낸 실패도 재시도한다. 거부되거나 순환하는 task는 혼자 실패하고, 순환이 아닌 공유 참조는 괜찮다. 창을 넘긴 실패 시도는 timeout이고 재시도하지 않는다. 스스로 종료한 worker는 crash이고, 예외를 던진 spawn은 batch를 `worker-spawn`으로 마무리하며, `plugin-trust`는 메시지 일치가 아니라 loader 거부다. `serializedBytes`는 UTF-8 byte다. `budget.maxWorkers`보다 많은 worker 수와 `budget.stepBudget`보다 큰 task step budget은 거부하고, plugin trial은 매번 새 worker에서 돌며, local backend는 끝나지 않는 동기 runner를 멈출 수 없고(worker pool은 멈출 수 있다), 종료 뒤에는 timer나 대체 worker가 남지 않는다. worker는 부모의 plugin root와 digest를 그대로 복사한다. 빈 root 목록이 모든 파일을 허용하지는 않는다.

JS bundle entry 목록은 `src/runtime/workers/entry.ts`를 포함하고, 그 entry는 CLI와 같은 transform plugin으로 빌드된다. bundle root가 `src`이므로 `dist/main.js`가 그대로 bin이고 worker는 `dist/runtime/workers/entry.js`다. 개발 worker는 모두 같은 preload 목록을 받는다. entry는 preload 변수로 분기하지 않는다. native compile은 단일 entry로 남는다. Node `worker_threads`, Cloudflare runner, 다중 머신 queue, 유료 실행은 범위 밖이다.

샘플 descriptor는 [examples/analysis/worker-trial.json](../examples/analysis/worker-trial.json)이다. 요구사항은 [worker-execution-backend.md](./requirements/active/worker-execution-backend.md)이다. 성능 예산은 [performance-budget.md](./performance-budget.md)에 남는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 검증

아래 명령은 macOS arm64, Bun 1.4.2, ttsc 0.30.4의 이 worktree에서 실행했다. 요구 파일 sha256 `6d1789d2c2e00d29d85b5104842f8efaa845a4c067afc279c4380c08800fa7d2`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, `docs:verify`는 unrun이다.

| 명령 | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test src/sim/executionBackend.test.ts` (`packages/core`) | 0 |
| `bun test --timeout 90000 src/runtime/workers/pool.test.ts` (`packages/cli`) | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| graph query (cwd는 이 worktree) | 0 |
| `bun run runtime:check` | 0 |
| `bun run public:check` | 0 |

첫 `evidence:check`는 placeholder review와 handler citation 두 건으로 2였다. 다음은 그 handler review로 2였다. 재실행은 0이었다. `graph:check`는 `createPlannerStrategy`에서 `stepOnce`를 hops 0의 unobserved로 남겼다.

PR #223 review 수정으로 요구 파일 sha256은 `9ea2fb7348d2d06130092635188d64ad6139e70bef82b892b12a90ce0de43d6e`이 됐다. 그 수정에서 `bun run typecheck`, `bun run test:conformance`, `bun run contracts:check`, `packages/core`의 `executionBackend.test.ts`, `packages/cli`의 `pool.test.ts`를 실행했다.

## Graph

`ttsc-graph` 0.30.4, protocol `2025-11-25`, generation identifier 없음, shutdown 0으로 조회했다. Lookup은 `runLocalBatch`를 `packages/core/src/sim/executionBackend.ts:241`, `finalizeBatch`를 `packages/core/src/sim/executionBackend.ts:198`, `runWorkerPool`을 `packages/cli/src/runtime/workers/pool.ts:46`, `runAnalysisTrial`을 `packages/cli/src/runtime/workers/trial.ts:101`에 둔다. `runWorkerPool`의 reverse execution trace (`maxDepth` 2, `maxNodes` 32)는 `pool.test.ts`의 pool host를 가리킨다. `finalizeBatch`의 같은 trace는 `runLocalBatch`와 `runWorkerPool`을 가리킨다. `graph:check`는 `ok unobserved createPlannerStrategy -> stepOnce (call is PlannerDeps.stepOnce; path hops=0; source default { stepOnce })`를 보고했다. forward trace (`maxDepth` 2, `maxNodes` 12)는 두 선언을 나열했고 call edge를 더하지 않았다. hops 0은 conformance가 아니다.
