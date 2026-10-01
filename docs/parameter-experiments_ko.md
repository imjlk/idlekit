# 파라미터 실험

영문 원문: [parameter-experiments.md](./parameter-experiments.md)

`runExperiment`는 등록된 model, strategy, session 파라미터를 비교한다. spec은 `ExperimentSpecV1`이다. `ScenarioV1`도 아니고 strategy만 다루는 `TuneSpecV1`도 아니다. `idk tune`은 strategy params를 그대로 튜닝한다. 새 명령은 `idk experiment <spec>`이다.

## 첫 버전이 재는 것

방법은 `fixed-sweep-and-one-at-a-time`이다. estimator는 `one-at-a-time-local-v1`이다. 이것은 한 번에 하나씩 움직이는 국소 민감도다. 전역 민감도가 아니고 Sobol index도 아니다. `globalSensitivity`와 `sobol`은 false다.

각 후보는 같은 seed, session, horizon에서 돈다. 파라미터를 다시 두면 `createRunFactory`가 새 model과 새 strategy를 만든다. 입력 scenario 객체는 쓰지 않는다. 경로는 기존 ParamSpace 종류와 model 또는 strategy `paramsSchema`를 통과한 점 식별자다. JSONPath, prototype 경로, eval 경로는 실행 전에 거부된다.

상대 elasticity는 baseline `p`와 `y`가 유한하고 0보다 크며 `p`가 바뀔 때만 보고한다. 그 밖에는 절대 변화와 방향만 남기거나 unavailable이다. 목표에 닿지 못하면 censored다. 시간은 null이다. horizon으로 바꾸지 않고, 그 값으로 미분하지 않는다.

기본 보고는 지표별 변화와 constraint violation id다. 가중 종합점수는 없다. 선택적 Pareto는 관측이 끝난 objective만 비교한다. censored이거나 실패한 objective는 `uncompared`이며 우월한 결과가 될 수 없다.

## 기준 예

fixture는 [parameter-experiment.json](../fixtures/conformance/parameter-experiment.json)이다. seed는 `28948`이다. 상수 수입, 목표 금액 `10`, step `1`, horizon `40`이다.

- model `incomeRate` baseline `1`은 `10`에 도달한다
- model probe `2`는 `5`에 도달하고 elasticity는 `"-0.5"`, 방향은 `lower`다
- model probe `0.5`는 `20`에 도달하고 elasticity는 `"-2"`, 방향은 `higher`다
- strategy `maxPicks` baseline `1`과 probe `2`는 둘 다 `10`에 도달하고 elasticity는 `"0"`, 방향은 `flat`이다

수입 probe의 task id는 `oat:incomeRate:2#28948`이다. model params는 `{"incomeRate":2}`이고 strategy params는 `{"maxPicks":1}`로 남는다. 정책 probe는 수입 `1`을 유지하고 `maxPicks`를 `2`로 둔다. 두 task 모두 engine id `number`, engine version, model id, model version을 기록한다. rate `1`에서 horizon `9`는 도달 시간을 `"9"`가 아니라 null로 남긴다.

artifact 계약은 `idlekit.experiment.v1`이고 schema는 `docs/schemas/generated/experiment.v1.schema.json`이다.

Node.js와 browser 런타임은 v1 호환 계약에 들어가지 않는다.
