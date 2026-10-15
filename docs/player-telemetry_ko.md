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
- 수익은 같은 통화의 환불 전 금액이다. 환불은 따로 내보낸다. 유저 식별자는
  로컬 가명 ID를 사용한다. 명령은 로컬 파일을 읽으며 외부로 데이터를 보내지 않는다.

리텐션은 `N일째 활동한 유저 / 전체 설치자`다. 표본 수와 Wilson 95% 구간을 표시한다.
7일까지 온전히 관측한 D7의 0%는 관측된 0이다. 아직 7일밖에 안 된 D30은
`not-observed`와 `null`로 남는다. 추정값이나 0으로 채우지 않는다. D1에는 쉬고
D7에 돌아올 수 있으므로 원시 관측률을 단조 감소시키지 않는다. LTV 모델의 곡선
가정은 별도로 검토한다.

## 결과 반영

가정이 D1 80%, 관측이 50%라면 차이는 **-30퍼센트포인트**다.
표에는 관측률, 설치·활동 인원, 구간, 명시한 가정과의 차이가 함께 나온다.
시나리오 기본값을 임의로 채우지 않으며 `unconfigured`, `not-observed`는 차이가 없다.

JSON에는 `observation`, 선택적인 `comparison`, `_meta`의 데이터·시나리오 해시가
포함된다. 관측 종료일도 데이터 해시에 포함된다.
`patchStatus`는 `ready`, 관측 일수가 부족한 `unavailable`, 곡선을 검토해야 하는
`requires-review`다. 원시 관측률이 뒤의 날짜에 상승하거나 보존할 명시 가정과
충돌하면 LTV 모델의 단조 감소 조건을 만족하지 못하므로 패치를 비우고
`patchWarnings`에 이유를 남긴다. 원시 관측과 비교는 보존한다. 관측값을 임의로
깎지 말고 곡선 가정을 검토한다.
ready일 때만 `scenarioPatch.monetization.retention`의 관측된 필드를 시나리오
**사본**의 기존 retention 객체에 병합하고 `validate`한다.
명시하지 않은 미래 일수의 가정도 별도로 검토한다. 미관측 일수의 가정, 모집단 규모, 수익·수수료·불확실성은
보존한다. 하루 미만의 관측 창은 빈 패치를 만든다. 나머지 `monetization` 추정치에는
기본 가정이 섞여 있어 이 패치에 자동으로 포함하지 않는다.

한 코호트로 보정하고 별도 코호트로 검증한다. 같은 출시 버전·유입·관측 조건에서
LTV 예측과 나중의 실측을 다시 비교한다. 보정에 쓴 유저로만 검증하면 예측력을
입증할 수 없다. 이 결과는 재미, 밸런스 변경의 인과 효과, 미래 매출을 입증하지
않는다. 그런 질문은 플레이테스트와 별도 A/B 실험으로 확인한다.

관측 종료일 없이 쓰는 기존 `calibrate`는 탐색용이다. 관측 기간이 명시되지 않은
리텐션 비율을 성숙한 실측으로 해석하지 않는다. `--scenario`에는 따라서
`--observed-through-day`가 필요하다. 차이를 보여주며 리텐션 임계치로 CI를 자동
실패시키거나 게임의 좋고 나쁨을 판정하지는 않는다.
