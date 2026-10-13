# 선택적 분석 judge

영문 원문: [optional-analysis-judge.md](./optional-analysis-judge.md)

`PR-18`은 끝난 분석 artifact 위에 선택적 rules judge를 둔다. 이것은 조언이다. balance-check 게이트를 대체하지 않고, ttsc, Evidence, Graph도 대체하지 않는다.

`idk judge <analysis.json> --rubric <rubric.json> --provider rules`가 명령이다. `--provider`는 `rules`만 받는다. `idk doctor`는 로컬 CLI 진단으로 남는다. `idk evaluate`는 `judge`를 직접 실행하지 않는 한 이 judge를 호출하지 않는다.

rubric은 데이터다. schema version 1, contract `idlekit.judge.rubric.v1`, rubric version, rules를 담는다. rule은 metric id, 연산자, threshold, 단위, severity, missing policy를 적는다. 알 수 없는 필드는 거부한다. 명령은 rubric 문자열을 코드로 평가하지 않는다.

숫자 pass와 fail은 balance-check engine에서 온다. 측정된 1.5h 첫 리셋은 `lte` 2를 통과한다. 측정된 3h는 `numerical` 안에서 실패하고 semantic `conflict`이기도 하다. numerical 객체는 다시 쓰이지 않는다. `baselineRewrite`는 false다. amount decimal을 JavaScript number로 좁히지 않는다.

artifact에 없는 metric id는 거부하고, reading 둘 이상과 맞는 metric id도 거부한다. `analysis-artifact-v1`이 아닌 artifact algorithm version도 거부한다. 추정은 `estimatedObservations`에 적고 측정 pass로 쓰지 않는다. 값이 없는 reading은 `insufficient`로 남는다. rule이 `missingPolicy: "fail"`이라 numerical verdict가 실패해도 마찬가지다. semantic 계약을 어긴 artifact(예: amount도 가진 숫자 reading)는 판정 전에 거부한다. 값이 없는 reading은 method를, 값이 없는 amount는 단위를 빼므로 rule의 값을 쓰고 missing policy가 수치 verdict를 정한다. 관측이든 추정이든 값이 있는 amount reading은 unsupported이다. artifact가 metrics capability를 unknown으로, coverage를 `incomplete`, `unknown`, `disabled`로 적으면 관측값도 측정값으로 보지 않고 `insufficient`로 남긴다. method를 적지 않은 reading(`readMetric`의 관측 reading과 값이 없는 reading)은 method로 비교하지 않고, reading이 적은 method는 맞아야 한다. 다른 동일성으로 측정된 reading은 `rec.metric.identity-mismatch`와 함께 `indeterminate`이다.

영어와 한국어 문장은 `recommendationId`가 고른 템플릿이다. rule의 `recommendationId`는 그 rule의 측정된 conflict 템플릿을 고른다. pass, 추정, insufficient, unsupported 결과는 고정 템플릿을 쓴다. advisory digest는 `rules:<rubricVersion>:<recommendation ids>`다. 같은 입력은 같은 digest를 낸다. 이 경로는 fetch하지 않는다.

구조 계약은 `idlekit.judge.v1`이고 경로는 [docs/schemas/judge.output.schema.json](./schemas/judge.output.schema.json)이다. 생성기는 [docs/schemas/generated/judge.v1.schema.json](./schemas/generated/judge.v1.schema.json)도 쓴다. 이것은 `ScenarioV1`이나 balance-check 문서를 바꾸지 않는다. JSON 출력은 정확히 그 문서이고 `_meta` 봉투를 붙이지 않는다. `--out`은 JSON, Markdown, CSV 모두에 적용된다. CSV는 rule마다 한 행에 수치 verdict, evidence, diagnostic을 담는다.

시간 예시의 재현 표식은 `18`이다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 명령

```bash
idk judge analysis.json --rubric rubric.json --provider rules
idk doctor --format json
```
