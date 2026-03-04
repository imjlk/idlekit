# idlekit

Bun workspace 기반의 범용 경제 시뮬레이터 프로젝트.

- `@idlekit/core`: 엔진/시나리오/시뮬레이터/분석/리포트 코어
- `@idlekit/cli`: `econ` CLI (`@bunli/core` + `bunli` toolchain)

## Workspace

```bash
bun install
```

## Build / Typecheck

```bash
bun run typecheck
bun run build
```

## CLI 개발

```bash
bun run --cwd packages/cli dev -- --help
```

## CLI 배포 빌드(bunli)

```bash
bun run --cwd packages/cli build
bun run --cwd packages/cli build:bin
```

## 예제

```bash
bun run --cwd packages/cli dev -- validate ../../examples/simple-linear.json
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json --duration 600 --strategy greedy
bun run --cwd packages/cli dev -- eta ../../examples/simple-linear.json --target-worth 1e5 --mode analytic
```
