# Seed와 검열 표본을 확인하는 예제

English version: [README.md](./README.md)

`bun install` 후 저장소 루트에서 아래 명령을 실행한다.
로컬 모델은 실행별 seed와 `createStreamRng`로 지급 여부와 지연을 한 번 뽑아
`vars`에 저장한다. 지급하지 않는 실행은 수입이 계속 0이다. 지급하는 실행은
지연이 지난 뒤 reward 시간 1초마다 토큰 1개를 얻는다. action은 없다.
step을 10초로 두어 하루짜리 실험의 실행량을 줄였다.

## 관측과 검열이 섞인 경우

```bash
bun run --cwd packages/cli dev -- experience ../../examples/experience/mixed-feedback.json \
  --plugin ../../examples/experience/seeded-feedback-plugin.ts \
  --plugin-root ../../examples/experience --allow-plugin true \
  --engine number --session-pattern short-bursts --days 1 --draws 16 --seed 7 --format json
```

현재 v1 알고리즘에서 `monteCarlo.firstVisible`의 기대 결과:

- `accounting`: draw 16개, 관측 9개, 우측 검열 7개, failed·unsupported 0개
- `uncertainty.zeroVariance`: `false`
- 관측된 표본만의 q10 / q50 / q90: reward 시간 `20` / `30` / `50`초
- 전체 표본의 p95: `status: "outside-observed-range"`, `value: null`

관측 표본 분위수는 관측된 9개만 읽는다. 전체 표본의 p95는 검열 표본도
포함하므로 아직 확정할 수 없다. 같은 명령을 다시 실행하면 Monte Carlo 요약이
같다. 이 모델의 영구적인 미지급 상태는 draw 수만 늘려도 지급 상태로 바뀌지 않는다.

## 관측 기간 안에 피드백이 없는 경우

```bash
bun run --cwd packages/cli dev -- experience ../../examples/experience/censored-feedback.json \
  --plugin ../../examples/experience/seeded-feedback-plugin.ts \
  --plugin-root ../../examples/experience --allow-plugin true \
  --engine number --session-pattern short-bursts --days 1 --draws 16 --seed 7 --format json
```

이 시나리오는 `model.params.payoutProbability`가 `0`이다. 관측 0개, 우측 검열
16개이며 `firstVisible.status`는 `unavailable`이다. 전체 p95도 `unavailable`이고
값은 `null`이다. 기존 `firstVisibleChangeSec` 요약도 `null`이다. 관측되지 않은
변화를 0초 완료로 채우지 않는다.

두 실험의 관측 한계는 reward 시간 51,900초다. `short-bursts`의 마지막 활성
블록이 끝나는 시점이며, 세션 전체는 wall 시간 86,400초를 다룬다.
피드백은 활성 블록에서 관측한다. 세션의 wall 한계는 별도의 시계다.

## 결정론적 대조군

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/11-my-game-v1.json \
  --engine number --session-pattern short-bursts --days 1 --draws 3 --seed 1 --format json
```

기본 템플릿의 linear 모델과 greedy 전략은 난수를 소비하지 않는다. 세 draw가
같은 결과를 내며 `firstVisible.uncertainty.zeroVariance`는 `true`다.
이 결과는 대조군으로 사용할 수 있다. 불확실성의 근거로 사용할 수는 없다.
[seed 경계 설명](../balance/linear/README.md#understand-the-seed-boundary)도 참고한다.

확인 후 `--format md`로 바꾸어 **Next checks**를 읽는다. 게임 모델을 수정할 때는
분위수와 함께 accounting과 관측 한계를 확인한다.
