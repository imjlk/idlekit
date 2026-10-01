# 선택적 분석 judge

영문 원문: [optional-analysis-judge.md](./optional-analysis-judge.md)

`PR-18`은 끝난 분석 artifact 위에 선택적 rules judge를 둔다. 이것은 조언이다. balance-check 게이트를 대체하지 않고, ttsc, Evidence, Graph도 대체하지 않는다.

`idk judge <analysis.json> --rubric <rubric.json> --provider rules`가 명령이다. `--provider`는 `rules`만 받는다. `idk doctor`는 로컬 CLI 진단으로 남는다. `idk evaluate`는 `judge`를 직접 실행하지 않는 한 이 judge를 호출하지 않는다.

rubric은 데이터다. schema version 1, contract `idlekit.judge.rubric.v1`, rubric version, rules를 담는다. rule은 metric id, 연산자, threshold, 단위, severity, missing policy를 적는다. 알 수 없는 필드는 거부한다. 명령은 rubric 문자열을 코드로 평가하지 않는다.

숫자 pass와 fail은 balance-check engine에서 온다. 측정된 1.5h 첫 리셋은 `lte` 2를 통과한다. 측정된 3h는 `numerical` 안에서 실패하고 semantic `conflict`이기도 하다. numerical 객체는 다시 쓰이지 않는다. `baselineRewrite`는 false다. amount decimal을 JavaScript number로 좁히지 않는다.

artifact에 없는 metric id는 거부한다. `analysis-artifact-v1`이 아닌 artifact algorithm version도 거부한다. 추정은 `estimatedObservations`에 적고 측정 pass로 쓰지 않는다. 값이 없는 reading은 `insufficient`로 남는다.

영어와 한국어 문장은 `recommendationId`가 고른 템플릿이다. advisory digest는 `rules:<rubricVersion>:<recommendation ids>`다. 같은 입력은 같은 digest를 낸다. 이 경로는 fetch하지 않는다.

구조 계약은 `idlekit.judge.v1`이고 경로는 [docs/schemas/judge.output.schema.json](./schemas/judge.output.schema.json)이다. 생성기는 [docs/schemas/generated/judge.v1.schema.json](./schemas/generated/judge.v1.schema.json)도 쓴다. 이것은 `ScenarioV1`이나 balance-check 문서를 바꾸지 않는다.

시간 예시의 재현 표식은 `18`이다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 명령

```bash
idk judge analysis.json --rubric rubric.json --provider rules
idk doctor --format json
```
