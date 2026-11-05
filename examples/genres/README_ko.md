# 장르 프리셋

English version: [README.md](./README.md)

이 디렉터리의 파일은 각각 `idk init scenario --preset <genre>`의 출력이며, `bun run templates:check`가 CLI 소스와 같은지 확인한다. 모든 프리셋은 내장 모델에서 돌아가므로 plugin이 필요 없다.

| 프리셋 | 파일 | 모델 | 보여 주는 것 |
| --- | --- | --- | --- |
| `cookie-clicker` | [`cookie-clicker-v1.json`](./cookie-clicker-v1.json) | `exponential` | 시드 고정 골든 쿠키 드롭, 프렌지 이벤트, 행운 클릭을 가진 빠르게 커지는 생산기 하나 |
| `tycoon` | [`tycoon-v1.json`](./tycoon-v1.json) | `multi-currency` | 여러 사업체, 상한 있는 프리미엄 재화, 넘침을 변환하는 시장 |
| `prestige-heavy` | [`prestige-heavy-v1.json`](./prestige-heavy-v1.json) | `prestige` | 짧은 런. `scripted` 전략이 `prestige.reset`이 열리자마자 리셋한다 |
| `crafting` | [`crafting-v1.json`](./crafting-v1.json) | `production-chain` | 나무와 돌을 모아 판자와 도구를 만들고 도구를 판다. 해금 조건과 저장 상한 |
| `session-arcade` | [`session-arcade-v1.json`](./session-arcade-v1.json) | `exponential` | 잦은 치명타, 보너스 라운드, log 소프트캡을 가진 30분 루프 |

## 프리셋

프리셋마다 설계 의도, 먼저 손볼 파라미터, 핵심 질문에 답하는 분석 명령을 적는다.

### `cookie-clicker`

- 의도: `frequent-progression`. 클릭과 자동 생산기 하나가 빠르게 커지고, 시드 고정 운 요소가 짧은 세션을 살린다.
- 주요 파라미터: `growthRate` 1.06과 `costGrowth` 1.15가 구매 주기를 정한다. `softCap`(`pow`, `1e5`부터, 강도 0.6)이 후반 성장을 꺾는다. `stochastic.crit`(2%, x7), `golden-cookie` 드롭(초당 0.005, 수입 300초분), `frenzy` 이벤트(15분마다 35%, 77초 동안 x7).
- 권장 명령:

```bash
idk experience cookie-clicker-v1.json --format md
idk eta cookie-clicker-v1.json --target-worth 1e6 --format json
idk growth cookie-clicker-v1.json --format json
```

### `tycoon`

- 의도: `scale-fantasy`. 건물이 쌓이고, 프리미엄 재화가 최상위 건물을 막으며, 넘친 재화는 되판다.
- 주요 파라미터: `generators` 사다리(`lemonade` → `newspaper` → `car-wash`, 단계별 `costBase`/`incomePerLevel`). `cap` 50, `valueInPrimary` 25인 `gold`. `investor`(gold 수입, `maxLevel` 20). gold로 사는 `bank`. `autoConvert: overflow`로 도는 `sell-gold` 교환(비율 20, 수수료 0.15).
- 권장 명령:

```bash
idk simulate tycoon-v1.json --format md
idk growth tycoon-v1.json --format json
idk evaluate tycoon-v1.json --format md
```

### `prestige-heavy`

- 의도: `strategic-optimization`. 리셋 루프가 곧 게임이다. 런은 짧고 리셋마다 영구 배율이 붙는다.
- 주요 파라미터: `prestige.requirement` `5e3`. 지수 0.5인 `root` `formula`. `multiplierPerPoint` 0.1(`additive`). `minRunSec` 300과 `minGain` 2가 리셋을 막는다. `starterCash`와 `keepLevels` 3이 재시작을 부드럽게 한다. `scripted` 전략은 매 루프에서 `prestige.reset`을 먼저 시도한다.
- 권장 명령:

```bash
idk simulate prestige-heavy-v1.json --format md
idk reset-policy prestige-heavy-v1.json --scan 300..1800 --step 300 --format md
idk prestige-cycle prestige-heavy-v1.json --format md
```

### `crafting`

- 의도: `strategic-optimization`. 자원이 레시피를 따라 흐르므로 체인이 해금될수록 병목이 옮겨 간다.
- 주요 파라미터: `valueInPrimary`(순자산 가중치)를 가진 `resources`와 `plank`의 `cap` 150. `lumberjack` → `quarry` → `sawmill` → `workshop` → `trader` 레시피마다 `inputs`, `outputs`, `timeSec`, `build` 비용, `unlock` 조건. `trader`의 `maxLevel` 20.
- 권장 명령:

```bash
idk simulate crafting-v1.json --format md
idk eta crafting-v1.json --target-worth 1e5 --format json
idk experience crafting-v1.json --format md
```

### `session-arcade`

- 의도: 30분 clock 안의 `frequent-progression`. 긴 꼬리보다 세션당 작은 성취가 많은 것이 중요하다.
- 주요 파라미터: `clock.durationSec` 1800. 싼 `costBase` 5와 `costGrowth` 1.1, `maxLevel` 120. 1000부터 `log` `softCap`. `stochastic.crit`(10%, x3). `bonus-round` 이벤트(3분마다 50%, 20초 동안 x4). `design.sessionPattern` `short-bursts`.
- 권장 명령:

```bash
idk experience session-arcade-v1.json --format md
idk evaluate session-arcade-v1.json --horizons 30m,2h --format md
```

## 튜토리얼

```bash
idk init scenario --preset cookie-clicker --out ./my-clicker.json
idk validate ./my-clicker.json
idk simulate ./my-clicker.json --format md
idk experience ./my-clicker.json --format md
idk evaluate ./my-clicker.json --format md
```

클론에서는 `idk` 대신 `bun run --cwd packages/cli dev --`를 쓴다.

- `experience`는 프리셋의 `design.sessionPattern`을 읽는다. 확률 프리셋은 `analysis.experience.draws`를 설정하므로 `experience`가 Monte Carlo 신뢰구간을 출력한다.
- `simulate` 중에 리셋하는 프리셋은 `prestige-heavy`뿐이다. 고정 리셋 간격 비교는 `idk reset-policy`로 한다.
- `--preset <genre>`는 시나리오 하나를 쓴다. `--wizard`, `--name`, `intro` 외의 track은 받지 않는다.
- 프리셋을 튜닝하려면 설계 연구 spec을 쓰고 `idk sensitivity`와 `idk optimize`를 실행한다. [고급 분석](../../docs/advanced-analysis_ko.md)을 본다.
