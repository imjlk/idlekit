# 엔진 연동 예제

영문 원문: [README.md](./README.md)

이 예제는 idlekit 시나리오 하나를 Godot, Unity, 게임 쪽 TypeScript 코드와 연결한다. 가이드는 [docs/engine-integration_ko.md](../../docs/engine-integration_ko.md)다.

## 파일

| 경로 | 용도 |
| --- | --- |
| `scenario.json` | 모든 단계에서 쓰는 카페 경제(`linear` 모델) |
| `cafe.engine-params.json` | `idk export engine --target generic --levels 25` 출력 |
| `godot/addons/idlekit/idlekit_economy.gd` | Godot 4용 `IdlekitEconomy` 리소스 스크립트 |
| `godot/data/cafe_economy.tres`, `godot/data/cafe_economy.json` | Godot export |
| `godot/tools/check_economy.gd` | headless 로드 검사 |
| `unity/IdlekitEconomy.cs`, `unity/Editor/IdlekitEconomyImporter.cs` | ScriptableObject와 에디터 임포터 |
| `unity/cafe_economy.json`, `unity/cafe_levels.csv` | Unity export |
| `import/shop-levels.csv` + `.mapping.json` | 곡선 피팅으로 import하는 레벨 테이블 |
| `import/balance-sheet.json` + `.mapping.json` | 필드 단위로 import하는 중첩 밸런스 시트 |
| `ts-runtime/economy.ts` | idlekit import가 없는 게임 쪽 경제 코드 |
| `ts-runtime/runtime-plugin.ts` | 이를 `runtimes`로 export하는 플러그인 |

커밋된 export 파일은 CLI 테스트와 `bun run docs:verify:quick`이 다시 생성해 비교하므로 항상 CLI와 일치한다.

## 실행

`packages/cli`에서:

```bash
# Export
bun run dev -- export engine ../../examples/engine-integration/scenario.json --target generic --levels 25
bun run dev -- export engine ../../examples/engine-integration/scenario.json --target godot --levels 25 \
  --out ../../examples/engine-integration/godot/data/cafe_economy.tres
bun run dev -- export engine ../../examples/engine-integration/scenario.json --target unity --file-format csv --levels 25

# Import 후 검증
bun run dev -- import scenario ../../examples/engine-integration/import/shop-levels.csv \
  --mapping ../../examples/engine-integration/import/shop-levels.mapping.json --out /tmp/imported-shop.json
bun run dev -- validate /tmp/imported-shop.json

# 런타임 검증
bun run dev -- verify runtime ../../examples/engine-integration/scenario.json \
  --plugin ../../examples/engine-integration/ts-runtime/runtime-plugin.ts --allow-plugin true \
  --runtime cafe.runtime.exact --seed 7 --format md
```

`cafe.runtime`은 출시된 게임 그대로이며 가격을 정수 코인으로 올림한다. 기본 허용 오차에서는 실패하고 올림된 가격을 모두 나열한다. `--abs-tolerance 1`은 올림을 허용한다. `cafe.runtime.exact`는 모델과 정확히 일치한다.

## Godot 검사

Godot 4.3 이상이 PATH에 있을 때:

```bash
cd examples/engine-integration/godot
godot --headless --path . --import
godot --headless --path . --script res://tools/check_economy.gd
```

스크립트는 `data/cafe_economy.tres`를 `IdlekitEconomy`로 로드해 가격 몇 개를 출력하고, `data/cafe_economy.json`이 같은 테이블을 주는지 확인한다. 저장소 CI는 Godot이나 Unity를 설치하지 않으며 C# 파일은 CI에서 컴파일하지 않는다.

## Unity

`unity/IdlekitEconomy.cs`를 프로젝트에, `unity/Editor/IdlekitEconomyImporter.cs`를 `Editor` 폴더에 복사한다. **Assets → idlekit → Import Economy JSON**에서 `cafe_economy.json`을 고른다. 런타임에서 `CostAt(owned)`와 `IncomeAt(owned, multiplier)`는 테이블을 읽고, 테이블 끝을 넘으면 곡선을 쓴다.
