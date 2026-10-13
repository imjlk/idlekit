# 밸런스 검사

영문 원문: [balance-checks.md](./balance-checks.md)

`PR-17`은 a/b, 7d/30d/90d KPI 회귀를 metric과 goal 밸런스 게이트로 넓힌다. 이 게이트는 게임 시나리오를 판정한다. ttsc, Evidence, Graph는 개발 품질 게이트다. 둘은 서로를 대체하지 않는다.

check 파일은 metric id, 연산자(`lt`, `lte`, `gt`, `gte`, `eq`, `between`), threshold, 단위, severity(`error` 또는 `warn`), missing policy(`inconclusive`, `fail`, `unsupported`)를 적는다. 기본 경로는 임의의 JavaScript를 평가하지 않는다. pass와 fail은 측정된 점 또는 lower/upper bound가 비교를 결정할 때만 나온다. missing이나 unknown 값을 0으로 보지 않는다. 남은 구간 전체가 threshold를 벗어나면 검열된 lower bound로 fail할 수 있다. bound가 없는 unknown p95는 inconclusive이다.

`idk evaluate --checks <file>`이 그 파일을 읽는다. `--fail-on`은 `error`, `warn`, `inconclusive`, `unsupported`를 나열한다. 기본값은 `error`다. 막는 결과는 exit 2다. 시나리오와 함께 실행하면 막는 결과는 workflow `ok`도 false로 둔다. 사용 오류는 CLI 사용 경로에 남는다. `--checks`를 빼면 기존 evaluate 흐름이 유지된다.

`idk kpi regress`는 호환 adapter다. flag와 fixture 형태는 유지된다. 현재 horizon 행을 같은 engine에 매핑한다. baseline을 다시 쓰지 않는다. baseline이 0이라 delta나 ratio가 무한대이면 가장 큰 유한수로 bound를 둔 censored observation으로 적어 evidence가 직렬화되게 한다. 양쪽이 모두 0이라 정의되지 않는 delta는 unknown이다.

비교하는 동일성은 definition, method, scenario version, spec version, engine id, plugin version, seed, algorithm version, unit이다. mismatch는 inconclusive이다. 보고서는 `baselineRewrite`를 false로 둔다.

각 check는 그 check가 고정한 모든 필드와 동일성이 맞는 observation으로 판정한다. 맞는 것이 없으면 같은 metric id의 첫 observation이 mismatch를 보고한다. 완전히 맞는 observation이 둘이면 모호하므로 inconclusive이다. lower가 upper보다 큰 bound는 모순이므로 inconclusive이다. check 파일에는 check가 하나 이상 있어야 한다. 빈 `checks` 배열, 읽을 수 없는 파일, 잘못된 JSON은 사용 오류다. 단독 JSON 문서는 정확히 `idlekit.balance-checks.v1`이고 `_meta` 봉투를 붙이지 않는다.

`ScenarioV1.outputs.assertions`는 선언만 한다. simulate와 evaluate는 그것을 실행하지 않는다. 분류되는 문법은 `&&`와 `||`로 잇는 `path operator value`이다. 그 외는 unsupported이다.

숫자 결과와 advisory 문장은 별도 필드다. advisory 문장은 pass/fail의 근거가 아니다. check는 외부 provider를 호출하지 않는다. JSON과 markdown 보고서는 실패한 metric의 status, value, bounds, operator, threshold, unit을 보여 준다.

구조 계약은 `idlekit.balance-checks.v1`이고 경로는 [docs/schemas/balance-checks.v1.schema.json](./schemas/balance-checks.v1.schema.json)이다. 생성기는 [docs/schemas/generated/balance-checks.v1.schema.json](./schemas/generated/balance-checks.v1.schema.json)도 쓴다. 이것은 `ScenarioV1`을 바꾸지 않는다.

시간 예시의 재현 seed는 `17`이다. 측정된 1.5h 첫 리셋은 `lte` 2h를 통과한다. 측정된 3h는 실패한다. 검열된 p95 lower bound 9h는 `lte` 8h를 실패한다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 명령

```bash
idk evaluate --checks checks.json
idk evaluate scenario.json --checks checks.json --fail-on error,inconclusive
idk kpi regress --baseline examples/bench/kpi-baseline.json --current examples/bench/kpi-baseline.json
```
