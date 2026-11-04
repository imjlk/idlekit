# 플레이 데이터로 리텐션 가정 검증하기

`experience`는 모델 안의 진행 속도를 측정한다. 실제 리텐션과 연결하려면 게임에서
관측한 별도 설치 코호트와 LTV 모델의 리텐션 가정을 비교한다.

```sh
idk calibrate examples/telemetry/cohort.csv --observed-through-day 7 --scenario examples/tutorials/14-orbital-foundry-v1.json --format md
idk calibrate examples/telemetry/cohort.csv --observed-through-day 7 --scenario examples/tutorials/14-orbital-foundry-v1.json --format json --out tmp/cohort-comparison.json
```

제공된 CSV는 작은 가상 데이터다. Orbital Foundry의 실제 성과를 입증하지 않는다.
소스 환경에서는 `bun run build` 후 `idk` 대신 `bun packages/cli/dist/main.js`를 쓴다.
가정만 읽으므로 시나리오의 플러그인은 실행하지 않는다.

## core API 사용

CLI와 같은 관측·패치 계획을 `@idlekit/core`에서 직접 사용할 수 있다:
`observeCohort`, `assertCohortObservation`, `observedRetentionRates`, `compareRetention`,
`planRetentionPatch`, `applyRetentionPatch`. 공개 `CohortActivityRow`는 `userId`와 정수
`day`를 요구하고 `active`의 기본값은 true다. 수익·획득 비용은 선택 필드이며 입력한 경우
유한한 음수 아닌 값인지 검사한다. 필드 생략은 수익 0의 관측이 아니다.

[SDK 실행 예제](../examples/telemetry/cohort-sdk.ts)는 가상 코호트를 직접 처리하므로 임시 CSV나
CLI 하위 프로세스가 필요 없다. 소스 체크아웃에서는 다음 명령으로 실행한다.

```sh
bun --preload @ttsc/unplugin/bun-register examples/telemetry/cohort-sdk.ts
```

`observeCohort(rows, observedThroughDay)`로 관측하고
`planRetentionPatch(observation, scenario.monetization?.retention)`으로 적용 가능 여부를 확인한다.
`applyRetentionPatch({ scenario, observation })`는 현재 시나리오에 맞춰 계획을 다시 계산하고
검증한 복사본을 반환한다. `unavailable`·`requires-review`는 예외로 거부하며, 외부의 임의 패치나
다른 시나리오에서 만든 오래된 계획을 그대로 적용하지 않는다. 관측된 잔존율만 바꾸고 미관측
잔존율·수익·수수료·획득 비용·불확실성·코호트 규모 가정을 보존한다. 공개 관측 소비 함수들은
직렬화된 관측의 인원수·비율·관측 종료일·구간 일관성도 검사한다. Wilson 95% 구간은
설치자와 잔존 인원수로 다시 계산한다. SDK 관측을 JSON으로 저장할 때 구간 경계를
반올림하지 말고, 화면에 표시할 때만 반올림한다.

SDK도 아래의 완전한 export를 전제로 한다. 데이터 수집이나 미수집 수익 적합은 수행하지 않으며,
export의 완전성 확인과 별도 검증 코호트는 호출자 책임이다.

## 데이터 준비

- 설치 날짜와 관측 종료 시점이 같은 코호트를 고른다. `--observed-through-day`는
  이탈 유저까지 포함해 **모든 유저가 온전히 관측된 마지막 경과 일수**다.
  마지막 접속일을 관측 종료일로 쓰지 않는다. 설치 시점이 다르면 코호트를 나눈다.
- 유저·날짜마다 한 행으로 집계한다. 다시 접속하지 않은 유저까지 **전체 설치자**의
  day 0 설치 행이 있어야 한다. 접속자만 내보내면 리텐션이 부풀려진다.
- 종료일까지 모든 활동을 내보낸다. 이 완전한 데이터에서 없는 날짜는 비활동으로
  세며 `active=false`도 비활동이다. 유저나 이벤트가 누락됐는지는 CLI가 알 수 없다.
- CSV의 `user_id`, `day`와 JSON의 문자열 `userId`, 숫자 `day`를 명시한다.
  날짜는 0 이상의 정수다. 중복 유저·날짜, 설치 행 누락, 종료일 이후 행,
  음수·무한대 수익은 거부한다. 리텐션만 측정하면 수익 열은 생략할 수 있다.
  생략한 열은 0이 아니라 미측정이며 `diagnostics.unmeasured`에 적는다. IAP와 광고
  수익이 모두 없으면 JSON 출력에 `monetization.revenue`, `monetization.uncertainty`,
  수익 합계가 없다. 둘 중 하나만 있으면 그 출처가 측정한 필드만 남는다. IAP는
  `payerConversion`, `arppuDaily`, `totalIap`을, 광고 수익은 `adArpDau`, `totalAd`를
  채우고, `correlation`에는 출처를 모두 내보낸 쌍만 남는다. 획득 비용 열이 없으면
  `monetization.acquisition`도 없다. JSON의 수익 필드는 모든 행에 넣거나 모든 행에서 뺀다.
- 수익은 같은 통화의 환불 전 금액이다. 환불은 따로 내보낸다. 유저 식별자는
  로컬 가명 ID를 사용한다. 명령은 로컬 파일을 읽으며 외부로 데이터를 보내지 않는다.

리텐션은 `N일째 활동한 유저 / 전체 설치자`다. 표본 수와 Wilson 95% 구간을 표시한다.
7일까지 온전히 관측한 D7의 0%는 관측된 0이다. 아직 7일밖에 안 된 D30은
`not-observed`와 `null`로 남는다. 추정값이나 0으로 채우지 않는다. D1에는 쉬고
D7에 돌아올 수 있으므로 원시 관측률을 단조 감소시키지 않는다. LTV 모델은 받은
기준점 사이를 선형 보간하고 값을 깎지 않으므로, 상승도 그대로 예측에 반영한다.

## 결과 반영

가정이 D1 80%, 관측이 50%라면 차이는 **-30퍼센트포인트**다.
표에는 관측률, 설치·활동 인원, 구간, 명시한 가정과의 차이가 함께 나온다.
시나리오 기본값을 임의로 채우지 않으며 `unconfigured`, `not-observed`는 차이가 없다.

JSON에는 `observation`, 선택적인 `comparison`, `_meta`의 데이터·시나리오 해시가
포함된다. 관측 종료일도 데이터 해시에 포함된다.
`patchStatus`는 `ready`, 관측 일수가 부족한 `unavailable`, 곡선을 검토해야 하는
`requires-review`다. 원시 관측률이 뒤의 날짜에 상승하거나 보존할 명시 가정과
충돌하면 완성된 retention 곡선은 d1 >= d7 >= d30 >= d90이어야 한다는 시나리오
규칙을 어기고, LTV 모델은 그 상승을 그대로 보간한다. 그래서 패치를 비우고
`patchWarnings`에 이유를 남긴다. 원시 관측과 비교는 보존한다. 관측값을 임의로
깎지 말고 곡선 가정을 검토한다. 미관측 날짜의 가정을 생략한 경우도 LTV 기본값과
충돌할 수 있으므로 패치를 보류한다. 짧은 관측 기간의 패치를 ready로 받으려면
미관측 목표 날짜마다 시나리오에 가정을 명시한다.
ready일 때만 `scenarioPatch.monetization.retention`의 관측된 필드를 시나리오
**사본**의 기존 retention 객체에 병합하고 `validate`한다.
기본값을 실측이나 검토된 가정으로 간주하지 않는다. 미관측 일수의 가정, 모집단 규모, 수익·수수료·불확실성은
보존한다. 하루 미만의 관측 창은 빈 패치를 만든다. 나머지 `monetization` 추정치에는
기본 가정이 섞여 있어 이 패치에 자동으로 포함하지 않는다.

한 코호트로 보정하고 별도 코호트로 검증한다. 같은 출시 버전·유입·관측 조건에서
LTV 예측과 나중의 실측을 다시 비교한다. 보정에 쓴 유저로만 검증하면 예측력을
입증할 수 없다. 이 결과는 재미, 밸런스 변경의 인과 효과, 미래 매출을 입증하지
않는다. 그런 질문은 플레이테스트와 별도 A/B 실험으로 확인한다.

관측 종료일 없이 쓰는 기존 `calibrate`는 탐색용이다. 관측 기간이 명시되지 않은
리텐션 비율을 성숙한 실측으로 해석하지 않는다. `--scenario`에는 따라서
`--observed-through-day`나 관측 종료일을 담은 코호트 배치가 필요하다. `calibrate`는
차이를 보여줄 뿐 게임의 좋고 나쁨을 판정하거나 CI를 실패시키지 않는다. 임계치 경보는
아래 `idk telemetry drift`에서 명시적으로 켠다.

CSV에도 `interval95Min`, `interval95Max`를 0~1 비율로 기록하며 미관측 날짜는
`null`로 남긴다. 스키마는 D1/D7/D30/D90 순서와 보류된 패치가 비어 있음을
검사한다. CLI는 인원수·비율·관측 종료일·신뢰구간 사이의 일치 여부도 검사한다.
`--out`이 텔레메트리나 시나리오 원본을 가리키면 하드링크와 디렉터리 별칭도
거부한다. 보고서는 별도 경로로 저장한다.

## 코호트 배치

설치 주차·출시 버전·실험 그룹처럼 여러 완전한 설치 코호트를 하나의 **코호트 배치**로
묶는다. 배치 안의 코호트는 각각 위의 데이터 준비 규칙을 따른다. JSON 형식은
[`cohort-batch.v1.schema.json`](./schemas/cohort-batch.v1.schema.json)이다.

```json
{
  "schemaVersion": 1,
  "cohorts": [
    {
      "id": "2026-w40-control",
      "variant": "control",
      "installDate": "2026-10-05",
      "observedThroughDay": 7,
      "rows": [{ "userId": "p-7f3a", "day": 0 }, { "userId": "p-7f3a", "day": 1, "iapRevenue": 0.99 }]
    }
  ]
}
```

CSV는 하나의 긴 표다. `cohort_id`, `observed_through_day`, `user_id`, `day`는 필수이고
`variant`, `install_date`, `active`, `iap_revenue`, `ad_revenue`, `acquisition_cost`는
선택이다. 코호트 단위 열은 코호트마다 값이 하나여야 한다. 알 수 없는 열은 거부하므로
실수로 섞인 `email` 열은 그대로 실리지 않고 실패한다.

```csv
cohort_id,variant,install_date,observed_through_day,user_id,day,active
2026-w40-control,control,2026-10-05,7,p-7f3a,0,true
2026-w40-control,control,2026-10-05,7,p-7f3a,1,true
```

검증은 알 수 없는 필드, 중복·잘못된 id, 잘못된 설치일, 일부 행에만 있는 수익 필드,
코호트별 관측 오류를 파일과 JSON 경로와 함께 한꺼번에 모아 보여준다. 한 명령에 준
모든 파일에서 코호트 id는 고유해야 한다. 예제는 가상 데이터다.
[`cohorts.csv`](../examples/telemetry/cohorts.csv)는 day 7까지 관측한 300명 코호트 3개,
[`cohorts.json`](../examples/telemetry/cohorts.json)은 작은 코호트 2개다.

`calibrate`도 배치를 읽는다. `--cohort <id>`로 코호트와 그 관측 종료일을 고르며,
`--observed-through-day`를 함께 주면 값이 같아야 한다.

```sh
idk calibrate examples/telemetry/cohorts.csv --cohort 2026-w41-control --scenario examples/tutorials/11-my-game-v1.json --format md
```

## 텔레메트리 루프

`idk telemetry`는 배치에 대해 관측·비교·패치·모니터링을 잇는다. 모든 하위 명령은
배치 파일 여러 개, `--input-format auto|csv|json`, `--format json|md`, `--out`을 받는다.
JSON에는 텔레메트리 해시를 담은 `_meta`가 붙는다.

```sh
idk telemetry validate examples/telemetry/cohorts.csv examples/telemetry/cohorts.json --format md
idk telemetry compare examples/telemetry/cohorts.csv --baseline 2026-w40-control --scenario examples/tutorials/11-my-game-v1.json --format md
idk telemetry drift examples/telemetry/cohorts.csv --scenario examples/tutorials/11-my-game-v1.json --threshold-pp 5 --fail-on-drift --format md
idk telemetry patch examples/telemetry/cohorts.csv --cohort 2026-w41-control --scenario examples/tutorials/11-my-game-v1.json --scenario-out tmp/my-game-w41.json --format md
idk telemetry experiment control=examples/tutorials/11-my-game-v1.json fast-start=examples/tutorials/12-my-game-compare-b.json --day 1 --mde-pp 5 --daily-installs 400 --format md
```

### 코호트 비교

`compare`는 코호트마다 D1/D7/D30/D90의 인원수·비율·Wilson 95% 구간과 기준 코호트
(`--baseline`, 기본값은 첫 코호트) 대비 차이, `--scenario`를 주면 명시 가정 대비 차이를
나란히 보여준다. 기준이 아닌 칸에는 `--alpha`(기본 0.05)의 합동 두 비율 z 검정으로
`significant`, `not-significant`, 기대 빈도가 5 미만이면 `insufficient-sample` 힌트를
붙인다. 예제에서 코호트당 300명일 때 fast-start의 D1 +7퍼센트포인트는
`not-significant`(p ≈ 0.08), 41주 차의 -8퍼센트포인트 하락은 `significant`(p ≈ 0.04)다.

힌트는 힌트일 뿐이다. 설치가 독립이고 미리 정한 비교가 하나라는 가정에 기댄다.
코호트·날짜가 많거나 결과를 여러 번 들여다보면 거짓 양성이 늘어난다. 표를 뒤지기보다
`experiment`로 실험을 미리 설계한다.

### 드리프트 감지

`drift`는 각 코호트를 시나리오의 명시 가정과 비교한다. 절대 차이가 `--threshold-pp`
(기본 5퍼센트포인트) 이상이고 **동시에** 가정이 코호트의 Wilson 95% 구간 밖에 있을 때
그 날짜를 드리프트로 본다. 작은 코호트의 잡음으로는 경보가 울리지 않는다.
`--no-require-interval`은 구간 조건을 끈다. 상태는 `drift`, `within-threshold`,
`no-comparable-days`다. `--fail-on-drift`를 주면 보고서를 먼저 쓰고 드리프트일 때
종료 코드 **2**로 끝난다. 다른 실패는 기존 CLI 종료 코드를 그대로 쓰므로 모니터가
"리텐션이 움직였다"와 "export가 깨졌다"를 구분할 수 있다.

드리프트는 곡선이 움직였다는 사실만 알려주고 원인은 설명하지 않는다. 패치 전에
출시 버전, 유입 구성, export 완전성을 확인한다.

### 패치와 재시뮬레이션

`patch`는 한 코호트에 대해 전체 루프를 실행한다.

1. 코호트를 관측한다(`observeCohort`).
2. 시나리오에 대한 리텐션 패치를 계획한다(`planRetentionPatch`).
3. 사본에 적용하고 패치된 시나리오를 검증한다.
4. 원본과 패치본에 **같은 시드**로 `ltv`를 실행해 리텐션 가정만 다르게 한다.
5. 가정 변경과 구간별 유저당 LTV·유저당 순수익·페이싱(`endNetWorth`, 첫 업그레이드
   시간, 일일 성장)의 전후 표를 보고한다.

원본 시나리오는 바꾸지 않는다. `--scenario-out`은 계획이 `ready`일 때만 패치본을
쓴다. 그렇지 않으면 아무것도 쓰지 않고 경고를 보고서에 남긴 뒤 종료 코드 **3**으로
끝난다. 리텐션은 경제 시뮬레이션이 아니라 LTV 예측에 들어가므로 페이싱은 그대로여야
한다. 페이싱이 바뀌면 리텐션 외의 무언가가 바뀐 것이므로 보고서가 표시한다.
`--horizons`, `--strategy`, `--seed`, 플러그인 옵션은 `ltv`와 같다. 패치본을 채택하기
전에 별도 검증 코호트로 확인한다.

### A/B 실험 설계

`experiment`는 `<group>=<scenario.json>`으로 시나리오 변형을 그룹에 연결한다. 첫 그룹이
대조군이다. 각 변형의 `--day`(1, 7, 30, 90) 가정을 읽어 다음을 돌려준다.

- `--alpha`와 `--power`(기본 0.05, 0.8)의 양측 두 비율 검정에 필요한 그룹당 최소
  표본 수. 처리군이 여럿이면 Bonferroni 보정을 한다. 최소 검출 효과는 `--mde-pp`이고,
  생략하면 변형 사이의 가장 작은 가정 차이다. 가정이 같으면 `--mde-pp`가 필요하다.
- 관측 기간. `--daily-installs`를 주면 등록 기간(최소 한 주)과, 등록된 모든 설치가
  시험 날짜까지 온전히 관측되는 가장 이른 판독일을 계산한다.
- 결정적 그룹 배정. `@idlekit/core`의 `assignExperimentGroup(userId, experimentId, groups)`는
  가명 id를 FNV-1a로 해시하므로 서버 없이도 게임과 분석이 같은 그룹을 쓴다.

예제는 D1 40% → 45%를 검출하려면 그룹당 1,534명이 필요하다고 답한다. 그룹마다
`variant`를 단 별도 코호트로 내보내고 판독일 이후 `compare`로 읽는다. 지표와 판독일은
출시 전에 고정하고 힌트를 보고 일찍 멈추지 않는다.

## 모니터링

[`monitor.sh`](../examples/telemetry/monitor.sh)는 export를 검증하고 `--fail-on-drift`로
`drift`를 실행해 시각이 붙은 보고서를 남긴다. 드리프트가 없으면 0, 있으면 2로 끝나고
다른 실패는 그대로 전달한다. crontab 예시는 다음과 같다.

```sh
0 9 * * 1 cd /srv/my-game && COHORTS=exports/cohorts.csv SCENARIO=scenarios/live.json ./examples/telemetry/monitor.sh
```

[`github-actions-monitor.yml`](../examples/telemetry/github-actions-monitor.yml)은 같은
스크립트로 매주 실행하고 보고서를 아티팩트로 올리는 GitHub Actions 예제다. 각자의
저장소에 복사해 쓰는 예제이며 idlekit에서 실행하지 않는다.

## 배치용 core API

`@idlekit/core`는 루프를 직접 쓸 수 있도록 `validateCohortBatch`, `observeCohortBatch`,
`compareCohorts`, `twoProportionSignificance`, `detectRetentionDrift`,
`planScenarioRetentionUpdate`, `planRetentionExperiment`, `assignExperimentGroup`을
내보낸다. [`telemetry-loop-sdk.ts`](../examples/telemetry/telemetry-loop-sdk.ts)는 가상
코호트로 이 함수들을 실행한다.

```sh
bun --preload @ttsc/unplugin/bun-register examples/telemetry/telemetry-loop-sdk.ts
```

## 개인정보와 익명화

모든 명령은 로컬 파일을 읽고 로컬에 보고서를 쓴다. 아무것도 업로드하지 않으며 가정을
읽을 때 시나리오 플러그인도 실행하지 않는다. 그래도 입력은 실제 플레이어를 나타내므로
개인정보가 필요 없도록 export를 준비한다.

- `userId`는 가명을 쓴다. 예를 들어 export 밖에 보관한 비밀 솔트로 내부 id의 HMAC을
  만든다. 이메일·이름·기기 또는 광고 id·계정 id·IP 주소는 내보내지 않는다. 알 수 없는
  열을 거부하는 이유도 이것이다.
- 계약에 필요한 것만 내보낸다. 설치 후 경과 일수, 활동 여부, 선택적으로 일 단위로 집계한
  수익과 획득 비용이다. 이벤트 로그, 위치, 하루보다 세밀한 시각은 내보내지 않는다.
- 수익은 통화의 최소 단위로 반올림하고 자유 입력 필드는 지운다.
- 코호트를 충분히 크게 유지한다. 몇 명뿐인 코호트는 개인을 특정할 수 있고, 리텐션도
  너무 흔들려서 판단 근거가 되지 못한다.
- export와 보고서는 원본 데이터와 같은 접근 통제 아래 보관한다. 경보에는 플레이어 행이
  아니라 드리프트 보고서만 담는다.
- 코호트를 시간에 걸쳐 연결할 필요가 없으면 export마다 솔트를 바꾸고, 한 실험 기간
  동안에만 고정한다.
