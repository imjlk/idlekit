# 성장 분류

영문 원문: [growth-classification.md](./growth-classification.md)

`analyzeGrowth`는 여전히 legacy 속도 버킷 `stall`, `softcap`, `exp`, `super-exp`를 반환한다. 그 이름은 log10 slope 임계값이다. 성장 형태가 아니고, 0에 가까운 버킷은 자원 병목이 아니다. `idk growth`와 experience snapshot은 그 보고서를 그대로 내므로 기존 KPI 출력은 유지된다.

`fitGrowth`는 별도 artifact다. sampling budget, method `growth-fit-v1`, method version 1, `windowSec`를 요구한다. `windowSec`는 시간 창이다. 표본 수가 1024 미만이어도 그 의미가 바뀌지 않는다. 형태와 속도는 다른 필드다. 형태는 관측 창의 후보인 `constant`, `polynomial`, `exponential`, `accelerating-log`, `saturating`, `unknown`이다. 후보는 점근 체제의 증명이 아니다.

양은 Engine에 남긴다. 양의 유한 값은 `absLog10`를 쓴다. `toNumber`는 절대 log10이 안전한 수 범위 안일 때만, 값 영역 잔차에만 쓴다. 0과 음수는 별도 domain이며 `abs`로 넘기지 않는다. 구매, reset, 부호 변화, 10배 하락은 새 창을 시작한다. 설정된 `analytic.softcap`은 형태 옆에 기록되고 형태를 고르지 않는다.

끊김은 sampling budget을 적용하기 전에 모든 표본에서 찾고, 각 끊김의 양쪽 점을 남기므로 downsampling이 0이나 하락을 숨기지 않는다. fit은 창 시작부터의 시간을 쓰므로 큰 절대 `t`가 기울기를 바꾸지 않는다. 값 영역 fit은 1로 내림하지 않은 계열 크기 단위로 하므로 단위를 바꿔도 형태가 바뀌지 않는다. 포화는 간격으로 나눈 증가율로 읽으므로 고르게 줄인 표본의 간격이 고르지 않아도 포화로 본다. 정확히 10배 하락도 하락이다. cadence가 거칠어도 양이 아니거나 유한하지 않은 domain은 `invalid`로 남는다. 값 영역에서 정확한 직선이나 포물선은 절편과 관계없이 `polynomial`이다. 다만 log 선형 fit이 더 정확하면 느린 지수도 `exponential`로 남는다. 불규칙 간격은 budget으로 줄이기 전의 입력 표본에서 읽는다. 실행 결과에서 action은 그 뒤 첫 trace 상태에서 새 창을 연다. retention이 비운 trace는 비어 있는 그대로다. action 기록이 완전하지 않으면 창은 형태 주장을 보류한다. action 수 0은 action 카운터가 관측됐을 때만 완전한 기록으로 본다. 기록된 action은 모델이 prestige action으로 내놓으면 reset이고, custom이 아닌 다른 kind면 id와 관계없이 purchase다. log 값은 첫 값에 대한 상대값으로 fit하므로 큰 log offset이 형태를 바꾸지 않고, 값이 움직이는 정확한 값 fit이나 기울기가 있는 정확한 log 선형 fit은 log 폭이 아주 작아도 `constant`가 아니다. softcap 힌트는 분석한 실행의 시작 상태에서 읽는다. sampling budget이 있으면 표본을 fit 창마다 남긴다. 모든 창에 충분한 표본을 줄 수 없으면 고르게 고른 일부 창만 fit하고 몇 개인지 경고한다. 가속은 log 이차항이 잔차보다 충분히 클 때이고, 포화는 남긴 표본 간격과 무관하게 판단하며, 양의 기울기면 언제나 doubling time이 있다. sampling budget은 창보다 먼저 끊김에서 나누므로 끊김 양쪽이 각자 몫을 받는다. 값 영역 fit은 Number 범위를 벗어난 양을 창의 최댓값에 대한 비율로 읽으므로 단위를 바꿔도 polynomial 형태가 유지된다. 포화 창은 평평한 plateau로 끝나도 되고, 그 잔차는 `log-rate` 공간의 포화 fit 잔차다. trace 상태에서 모델이 내놓지 않은 기록된 action은 prestige count 변화가 reset을 확인하지 않는 한 purchase다.

이후 Analyzer adapter는 `GrowthSamplingContract`를 넘기고 `GrowthFitArtifactV1`를 읽어야 한다. legacy enum으로 regime을 추론하지 않는다. 구조 schema는 `idlekit.growth-fit.v1`이다.

RNG는 없다. 수식과 실행한 시뮬레이션 케이스는 `fixtures/conformance/growth-shapes.json`이다. 재현 라벨은 그 파일이다. slope 허용 오차는 `1e-4`다.

Node.js와 브라우저 런타임은 v1 호환 계약에 포함되지 않는다.
