# 계약 생성

영문 원문: [contract-generation.md](./contract-generation.md)

`TC-05`는 TypeScript 타입 `ScenarioV1`에서 구조적 JSON Schema를 만든다. 런타임 의미 검증은 `validateScenarioV1`이다. 생성기는 cross-field 규칙, registry 존재, 큰 수 parser, 안전한 식을 추론하지 않는다.

## 명령

저장소 루트에서 Bun `1.4.2`와 `@ttsc/unplugin/bun-register` preload를 쓴다. 루트 `tsconfig.json`은 없다. 이 스크립트의 가장 가까운 프로젝트는 `tools/tsconfig.json`이다. `ScenarioV1` 변환은 `packages/core/tsconfig.json`에서 한다.

```bash
bun run contracts:check
bun run contracts:generate
```

`contracts:check`가 CI 경로다. `docs/schemas/generated/`를 쓰지 않는다. 바이트가 다르면 종료 코드 1이다. 기록은 `contracts:generate`만 한다. check에 `--write`를 주면 종료 코드 2다.

설치본 export는 typia `14.0.6`의 `typia.json.schema`이고 OpenAPI `3.1`이다. `$id`는 `https://idlekit.dev/schemas/scenario.v1.schema.json`이다. 문서에는 생성기 이름 `idlekit.contract-generator`, 버전 `1`, typia pin, 읽은 상대 경로 소스의 sha256이 있다. 그 해시에 시각과 절대 경로는 없다.

## 등록 범위

`packages/core/src/scenario/scenarioContract.ts`의 `contractRegistry`는 `idlekit.scenario.v1`만 담는다. 이후 분석 DTO는 항목과 concrete `typia.json.schema` 호출을 추가한다. 기존 출력 schema를 이 목록으로 옮기지 않는다. `docs/schemas/*.output.schema.json`의 CLI 출력 schema는 손으로 쓴 계약이다.

`scenario.v1.fields.json`은 생성된 schema에 이미 있는 이름, const 값, description이다. 설계 의도, 예시 숫자, 한국어 문장은 authored 문서에 둔다.

## 런타임 차이

schema 본문은 `additionalProperties`가 false다. `typia.createValidate<ScenarioV1>()`는 알 수 없는 키를 허용한다. `validateScenarioV1`도 허용한다. schema 문장을 기존 시나리오 파일의 새 거부로 보지 않는다.

`stepSec`가 `0`, `-1`, `NaN`이거나 금액이 빈 문자열이거나 정지 조건이 없는 clock은 `validateScenarioV1`만 실패한다. `meta: null`은 그 반대다. 차이는 [요구사항](./requirements/active/typed-contract-generation.md)에 있다. 마이그레이션이 아니다.

`FiniteUnitRate`는 `tags.Minimum`과 `tags.Maximum`을 보여 준다. 시나리오 필드에는 그 brand를 붙이지 않는다.

validator와 시나리오 schema는 모듈을 읽을 때가 아니라 처음 호출할 때 만든다. 번들된 CLI가 읽는 plugin은 typia 변환 없이 core 소스를 import할 수 있다. 그 import는 contract 함수를 실행하기 전에는 던지지 않는다.

## 네 경로

`tools/contract-smoke.ts source`는 패키지 preload로 probe를 실행한다. `bun test`는 `scenarioContract.test.ts`를 실행한다. `tools/contract-smoke.ts bundle`은 저장소 밖에서 변환된 파일을 실행한다. `tools/contract-smoke.ts pack`은 발행 tarball을 저장소 밖에서 설치한다. 앞의 세 경로는 단위 테스트가 실행한다. pack은 별도 명령이다.

Node.js and browser runtimes are not part of the v1 compatibility contract.
