# 게임 엔진 연동

영문 원문: [engine-integration.md](./engine-integration.md)

idlekit은 경제를 `ScenarioV1` 파일에 둔다. 게임 엔진은 자체 리소스, 테이블, 코드에 둔다. 세 명령이 둘 사이에서 숫자를 옮기고, 둘이 여전히 같은지 확인한다.

| 방향 | 명령 | 결과 |
| --- | --- | --- |
| idlekit → 엔진 | `idk export engine --target generic\|godot\|unity` | 엔진 중립 JSON, Godot `.tres` 리소스, Unity JSON/CSV |
| 엔진 → idlekit | `idk import scenario <table> --mapping <mapping.json>` | `idk validate`를 통과하는 `ScenarioV1` |
| 엔진 ↔ idlekit | `idk verify runtime <scenario> --plugin <adapter.ts> --runtime <id>` | 게임의 수입/비용 함수와 idlekit 모델의 diff 보고서 |

세 명령 모두 결정론적이다. export에는 타임스탬프가 없어서 같은 시나리오는 항상 같은 바이트를 쓴다. 런타임 검증은 `--seed`를 받아 게임 코드에 넘긴다.

전체 예제는 [examples/engine-integration](../examples/engine-integration/README_ko.md)에 있다.

## Export

```bash
idk export engine scenario.json --target generic --out economy.engine-params.json
idk export engine scenario.json --target godot --out economy.tres
idk export engine scenario.json --target godot --file-format json --out economy.json
idk export engine scenario.json --target unity --out economy.unity.json
idk export engine scenario.json --target unity --file-format csv --csv-table levels --out levels.csv
```

| 플래그 | 기본값 | 의미 |
| --- | --- | --- |
| `--target` | `generic` | `generic`, `godot`, `unity` |
| `--file-format` | 타깃 기본값 | `generic`: `json`. `godot`: `tres` 또는 `json`. `unity`: `json` 또는 `csv` |
| `--levels` | `50` | 미리 계산한 레벨 테이블 행 수 (`0`이면 끔) |
| `--csv-table` | `auto` | Unity CSV: `levels`, `parameters`, `auto`(레벨이 있으면 levels) |
| `--godot-script` | `res://addons/idlekit/idlekit_economy.gd` | `.tres`에 기록할 스크립트 경로 |
| `--out` | stdout | 출력 파일 |

### 중간 포맷

모든 타깃은 엔진 중립 문서 `idlekit.engine-params` 버전 1에서 렌더링된다. schema는 [schemas/engine-params.v1.schema.json](./schemas/engine-params.v1.schema.json)이다.

- `source`에는 시나리오 id, 제목, `scenarioHash`, CLI 버전이 있어서 게임이 어떤 시나리오에서 나온 데이터인지 알 수 있다.
- `parameters`는 모델 파라미터를 타입(`amount`, `number`, `integer`, `boolean`, `string`)과 역할(`income`, `cost`, `growth`, `other`)과 함께 나열한다. amount는 문자열로 남아서 float64 범위를 넘는 값도 보존된다.
- `curves`는 닫힌 형태의 곡선을 설명한다. 내장 `linear` 모델은 `buy.generator.cost`(기하: `cost(n) = base * growth^n`)와 `income`(선형: `incomePerSec(n) = (base + perUnit * n) * prestigeMultiplier`)이다.
- `levels`는 idlekit 모델이 직접 계산한 레벨 테이블이다. 보유 수마다 다음 유닛 가격, 그 레벨까지 쓴 총액, 초당 수입이 있다. 값이 float64 범위를 벗어나면 note와 함께 일찍 끝난다.
- `initial`, `clock`, `policy`, `strategy`는 나머지 시나리오를 담아서 `idk import scenario`가 다시 만들 수 있다.

플러그인 모델은 파라미터를 점 표기 평탄 키(`upgrade.growth`)와 note로 export한다. 곡선과 레벨 테이블은 내장 `linear` 모델에서만 계산한다.

### Godot

`.tres`는 `IdlekitEconomy` 스크립트에 묶인 Godot 4 텍스트 리소스(`format=3`)다. [examples/engine-integration/godot/addons/idlekit/idlekit_economy.gd](../examples/engine-integration/godot/addons/idlekit/idlekit_economy.gd)를 프로젝트에 복사하고 리소스를 로드한다.

```gdscript
var economy := load("res://data/economy.tres") as IdlekitEconomy
var price := economy.cost_at(owned)
var income := economy.income_at(owned, prestige_multiplier)
```

타입: `cost_table`과 `income_table`은 `PackedFloat64Array`, `parameters`는 `Dictionary`, `curves`는 딕셔너리 `Array`다. JSON 변형은 같은 snake_case 키를 쓰고 `IdlekitEconomy.from_json_file(path)`로 로드한다. 예제에는 Godot 4.3에서 두 파일을 로드하는 headless 검사가 들어 있다.

### Unity

JSON 출력은 `JsonUtility`가 [examples/engine-integration/unity](../examples/engine-integration/unity/IdlekitEconomy.cs)의 `IdlekitEconomy` ScriptableObject에 바로 매핑하는 camelCase 필드를 쓴다. 각 amount에는 `double` 필드가 있고, 정밀도가 중요한 곳에는 텍스트 필드(`text`, `baseText`, `costText`)가 함께 있다. 에디터 메뉴 `Assets/idlekit/Import Economy JSON`이 에셋을 만든다. CSV 출력은 스프레드시트형 임포터용 테이블 하나다: `level,cost,totalCost,incomePerSec` 또는 `key,type,role,value`.

## Import

`idk import scenario`는 CSV, JSON, YAML 테이블을 읽어 `ScenarioV1`을 쓴다. 쓰기 전에 `idk validate`와 같은 레지스트리로 결과를 검증하고, 피팅 요약과 경고를 stderr에 출력한다.

```bash
idk import scenario levels.csv --mapping levels.mapping.json --out scenario.json --report-out import-report.json
idk validate scenario.json
```

`idlekit.engine-params` 문서는 매핑 없이 import된다. 이것이 왕복 경로다. `export engine --target generic` 다음 `import scenario`가 모델, clock, policy, 초기 상태, strategy를 다시 만든다.

### 매핑 설정

매핑 schema는 [schemas/import-mapping.v1.schema.json](./schemas/import-mapping.v1.schema.json)이다.

| 섹션 | 용도 |
| --- | --- |
| `source.rows` | JSON/YAML 문서 안 행 배열의 점 표기 경로. CSV 행은 그대로 쓴다. |
| `source.where` | 필드가 이 값과 같은 행만 남긴다. |
| `units.suffixes` | 숫자 접미사. `K`, `M`, `B`, `T`는 내장이고 `"Qa": 1e15` 등을 추가한다. `1,500`과 `1_500`은 `1500`으로 읽는다. |
| `units.timeUnit` | 수입 열의 시간 단위: `sec`, `min`, `hour`, `day`. 비율은 초당으로 변환된다. |
| `scenario` | `id`, `title`, `unit`, `clock`, 선택 `policy`(기본 `accumulate`, `maxLogGap` 14)와 `strategy`(기본 `greedy`). |
| `model.params` | 모델 파라미터마다 하나: `{ "from": "column", "timeUnit"?, "scale"?, "type"? }` 또는 `{ "value": ... }`. |
| `curves` | 레벨 테이블에서 `linear` 모델 파라미터를 피팅: `level`, `cost`(기하 피팅), `income`(선형 피팅), `timeUnit`. |
| `initial` | `wallet`, `owned`, `prestigeMultiplier`. 각각 필드 또는 값. |

명시한 `model.params`가 곡선 피팅보다 우선한다. 매핑되지 않은 `linear` 파라미터는 모델 기본값을 쓰고 경고한다. 피팅이 어떤 행에서 5% 넘게 어긋나도 경고한다. 테이블이 `linear` 모델로 재현할 수 없는 곡선을 따른다는 뜻이고, 이때는 플러그인 모델이 더 맞는 대상이다. `--report-out` 파일은 파라미터마다 출처(`field`, `value`, `fit`, `default`)와 피팅 품질(`r2`, `maxRelError`)을 기록한다.

### 매핑 예시

접미사가 붙은 가격과 분당 수입을 가진 레벨 테이블:

```csv
level,item,price,income_per_min
0,Espresso Machine,25.00,30
2,Espresso Machine,31.36,60
...
40,Espresso Machine,2.33K,630
```

```json
{
  "format": "idlekit.import-mapping",
  "formatVersion": 1,
  "scenario": {
    "id": "imported-shop",
    "unit": { "code": "COIN", "symbol": "C" },
    "clock": { "stepSec": 1, "durationSec": 1800 }
  },
  "curves": { "level": "level", "cost": "price", "income": "income_per_min", "timeUnit": "min" },
  "initial": { "wallet": { "value": "50" } }
}
```

피팅 결과는 `buyCostBase ≈ 25`, `buyCostGrowth ≈ 1.12`, `incomePerSec = 0.5`, `buyIncomeDelta = 0.25`다.

중첩된 밸런스 시트에서 경제 하나를 고르고 시간당 비율을 쓰는 경우:

```json
{
  "format": "idlekit.import-mapping",
  "formatVersion": 1,
  "source": { "rows": "economies", "where": { "name": "mine" } },
  "units": { "timeUnit": "hour" },
  "scenario": { "id": "imported-mine", "unit": { "code": "GOLD" }, "clock": { "stepSec": 1, "durationSec": 3600 } },
  "model": {
    "id": "linear",
    "version": 1,
    "params": {
      "incomePerSec": { "from": "production.perHour" },
      "buyIncomeDelta": { "from": "production.perUpgradePerHour" },
      "buyCostBase": { "from": "upgrade.baseCost" },
      "buyCostGrowth": { "from": "upgrade.costMultiplier" }
    }
  },
  "initial": { "wallet": { "from": "start.gold" }, "owned": { "from": "start.lumberjacks" } }
}
```

시간당 `"18K"`는 `incomePerSec: "5"`가 된다. 플러그인 모델은 어떤 키든 `model.params`로 받는다. `curves`는 내장 `linear` 모델만 피팅한다.

## 런타임 검증

게임은 수입/비용 공식을 자체적으로 따로 갖고 있는 경우가 많다. `idk verify runtime`은 그 사본을 idlekit 모델과 비교한다.

플러그인은 `@idlekit/core`의 `RuntimeEconomyAdapter` 배열 `runtimes`를 export한다.

```ts
import type { RuntimeEconomyAdapter } from "@idlekit/core";
import { CafeEconomy, CAFE_ECONOMY } from "./economy"; // 게임 코드, idlekit import 없음

let economy = new CafeEconomy(CAFE_ECONOMY, 0);
export const runtimes: readonly RuntimeEconomyAdapter[] = [
  {
    id: "cafe.runtime",
    init: (ctx) => {
      economy = new CafeEconomy(CAFE_ECONOMY, ctx.seed);
    },
    incomePerSec: (state) => economy.incomePerSec(Number(state.vars.owned), state.prestigeMultiplier),
    actionCosts: (state) => ({ "buy.generator": economy.machineCost(Number(state.vars.owned)) }),
  },
];
```

```bash
idk verify runtime scenario.json --plugin ./runtime-plugin.ts --allow-plugin true --runtime cafe.runtime --seed 7
```

명령은 Number 엔진으로 시나리오를 시뮬레이션한 뒤 trace된 모든 상태(`--trace-every` step마다)에서 어댑터를 호출한다. 같은 상태에서 `incomePerSec`과 `actionCosts`가 돌려준 각 행동 가격을 idlekit 모델과 비교한다. 양쪽이 같은 상태를 보므로 차이는 궤적 drift가 아니라 공식 차이다.

| 플래그 | 기본값 | 의미 |
| --- | --- | --- |
| `--runtime` | 유일한 어댑터 | 플러그인이 여러 개를 export할 때 어댑터 id |
| `--seed` | 시나리오와 runtime id에서 유도 | `init({ seed })`와 모든 probe에 전달 |
| `--duration` | 시나리오 duration | 시뮬레이션할 초 |
| `--trace-every` | `1` | N step마다 probe |
| `--rel-tolerance` / `--abs-tolerance` | `1e-9` / `0` | 둘 중 하나만 만족해도 일치 |
| `--max-rows` | `20` | 보고서에 남길 불일치 행 수 |
| `--fail-on-mismatch` | `true` | 값이 하나라도 다르면 종료 코드 1 |
| `--format` | `json` | `json` 또는 `md` |

JSON 보고서는 [schemas/runtime.verify.output.schema.json](./schemas/runtime.verify.output.schema.json)을 따른다. 지표별 개수와 최대 차이, 첫 불일치, 상태 `vars`가 포함된 불일치 행을 담는다. `_meta`에는 seed, 시나리오 해시, 플러그인 digest가 있다.

어댑터 결정론 규칙:

- 모든 난수 생성기는 `init`의 `seed`로 시드한다. `init`은 검증마다 한 번 실행된다.
- 시계, 네트워크, 전역 상태를 읽지 않는다.
- 유한한 숫자나 decimal 문자열을 돌려준다. `null`은 값을 쓸 수 없다는 표시다. 한쪽만 `null`인 probe는 불일치로 센다.

예제 게임은 가격을 정수 코인으로 올림한다. `cafe.runtime` 어댑터는 기본 허용 오차에서 실패하고 `--abs-tolerance 1`에서 통과한다. `cafe.runtime.exact`는 정확히 일치한다.

## 관련 문서

- [플러그인과 어댑터 가이드](./plugin-and-adapter_ko.md)
- [출력 schema](./schemas/README_ko.md)

### 구조화 파라미터와 v1 호환성

일반 `idlekit.engine-params` v1 파라미터에는 `type: "string"`과 함께 선택적인 `encoding: "json"`을 사용할 수 있다. 값은 배열·빈 객체·null의 JSON이며, 나머지 객체 속성은 점 경로로 유지한다. import는 이 표시가 있는 값만 복원하므로 `[1,2]`, `{}` 같은 실제 문자열은 문자열로 유지된다. 기존 스칼라 출력은 바뀌지 않는다. 예전의 표시 없는 출력은 배열과 실제 문자열을 구분할 수 없으므로 추측하여 변환하지 말고 원본 시나리오에서 다시 export한다. 예전 strict 스키마를 쓰는 소비자는 선택 필드가 추가된 스키마로 갱신해야 한다.

Godot JSON/TRES는 표시된 값을 네이티브 배열·객체·null로 출력한다. Unity JSON은 `text`에 JSON을 보존하고 해당 파라미터에만 `encoding`을 추가한다. 파라미터 CSV도 필요할 때만 `encoding` 열을 추가하므로 스칼라 CSV 헤더는 유지된다. 자동 시나리오 import는 일반 문서만 받는다. Unity/Godot 소비자는 게임에 맞는 구조화 데이터 처리가 필요하며 예제 런타임에 새 제작 로직을 생성하지는 않는다.
