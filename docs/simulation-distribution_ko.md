# 시뮬레이션 분포

영문 원문: [simulation-distribution.md](./simulation-distribution.md)

`analyzeDistribution`은 고정된 draw를 요약한다. 각 표본은 `observed`, `censored`, `failed`, `unsupported` 중 하나다. 완료율은 observed를 observed와 right-censored의 합으로 나눈 값이다. 실패하거나 검열된 표본은 0초에 끝난 시간이 아니다.

## 전체 분위수와 조건부 분위수

방법은 `inclusive-floor-index` 버전 1이다. 순위는 `floor((n - 1) * q)`다. 키는 `q` 뒤에 확률 자신의 문자를 붙인다. 퍼센트 반올림으로 `q0.946`과 `q0.954`가 합쳐지지 않는다.

전체 분위수는 하나의 공통 horizon을 쓴다. 검열된 draw는 그 horizon보다 뒤에 둔다. 요청한 순위가 그 꼬리에 있으면 status는 `outside-observed-range`이고 값은 null이다. 완료 표본만의 분위수는 `completed-only`로 적힌 별도 목록이다. 검열 시각이 제각각인 생존 추정은 하지 않는다. 공통 horizon이 없으면 전체 값은 unavailable이다. 공통 horizon을 넘는 관측값은 거부한다. 그때 검열된 draw의 순위를 알 수 없기 때문이다. 네 가지가 아닌 표본 status나 두 가지가 아닌 source도 거부한다. 음수인 첫 가시 시간은 failed 표본이다. 관측값은 number가 정확히 담는 값이어야 한다. `"1e3"`은 1000으로 남고 `"9007199254740993"`은 거부한다. 평균은 2의 거듭제곱으로 나눈 보정 합으로 구하므로 유한한 표본이 넘치지 않고, 큰 값끼리 상쇄돼도 작은 잔차가 남는다. number 범위를 넘는 분산은 경고와 함께 null이다. 반올림해서 같은 legacy 키가 되는 분위수가 있으면 정확히 그 퍼센트인 쪽이 키를 지키므로 `q50`은 계속 중앙값이다. `idk experience`는 검열된 draw가 정확히 하나의 관측 horizon을 공유하고 그 뒤에 관측된 변화가 없을 때 그 공통 horizon을 넘긴다. 검열된 draw가 없으면 draw마다 멈춘 시각이 달라도 전체 분위수를 추정한다. 같은 분위수는 한 번만 분석한다.

관측된 값이 없으면 unavailable이다. 평균 `0`도 아니고 0초 달성도 아니다.

## 평균

`arithmetic-mean`, `mean-of-log10`, `log10-of-arithmetic-mean`은 세 칸이다. log10의 평균을 재산의 평균이라고 적지 않는다.

## 시드와 출처

산출물은 `drawId`, `drawIndex`, `seed`를 논리적 인덱스 순서로 담는다. 그 순서는 worker 수와 무관하다. `simulateMonteCarlo`도 같은 논리 시드를 쓴다. common random numbers는 execution stream이 있어야 하고, 없으면 throw한다. 이 변경은 로컬 실행만 하며 worker를 추가하지 않는다.

불확실성 출처는 `model-strategy-session`, `monetization`, `mixed`다. 결정적 모델은 분산 `0`을 보고할 수 있다. 그것은 오류가 아니다.

`summarizeExperienceMonteCarlo`는 첫 가시 변화가 없을 때 활성 시간이나 0으로 바꾸지 않는다. legacy 숫자 칸은 관측된 변화만 평균한다. 붙은 `firstVisible` artifact가 검열된 draw를 유지한다.

## 기준 예

시드는 고정이다. drop fixture는 [independent-drop.json](../fixtures/conformance/independent-drop.json)이다. seed `28947`, draw 10000, 확률 `0.01`, 절대 tolerance `0.005`. 논리 draw마다 uniform을 하나 쓴다. 검사는 tolerance이고 `0.01`과 정확히 같아야 한다는 조건이 아니다.

분위수 예는 정렬된 표본 `[1, 2, 3, 4, 5]`다.

- q0은 `"1"`, q0.5는 `"3"`, q0.95는 `"4"`, q1은 `"5"`
- `"10"` 아흔 개와 검열 열 개, horizon 40의 완료율은 `0.9`
- 전체 p95는 null이고 `outside-observed-range`
- 완료 표본만의 q0.95는 `"10"`

Node.js와 브라우저 런타임은 v1 호환 계약에 들어가지 않는다.
