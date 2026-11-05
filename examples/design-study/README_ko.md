# 설계 연구

English version: [README.md](./README.md)

`forge-study.json`은 [`26-exponential-forge-v1.json`](../tutorials/26-exponential-forge-v1.json)용 설계 연구 spec이다. `costGrowth`, `growthRate`, `costBase`(로그 스케일)를 바꾸고, 첫 마일스톤까지의 시간, 짧은 세션 페이싱, 최종 순자산으로 점수를 매긴다.

```bash
bun run --cwd packages/cli dev -- sensitivity ../../examples/tutorials/26-exponential-forge-v1.json --spec ../../examples/design-study/forge-study.json --method morris --max-runs 40 --format md
bun run --cwd packages/cli dev -- optimize ../../examples/tutorials/26-exponential-forge-v1.json --spec ../../examples/design-study/forge-study.json --method ga --max-runs 60 --write-best /tmp/forge-best.json --format md
```

spec 형식은 [고급 분석](../../docs/advanced-analysis_ko.md#설계-연구-spec)에 있다.
