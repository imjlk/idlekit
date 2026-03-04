# Adapter Pattern Example

이 예제는 `Engine<N>` 어댑터를 통해 `bigint` 고정소수점 엔진을 시뮬레이터에 연결하는 방법을 보여줍니다.

파일:

- `fixedPointEngine.ts`: `Engine<bigint>` 구현
- `run.ts`: 커스텀 엔진 + 모델 + 내장 greedy 전략으로 시뮬레이션 실행

## 실행

프로젝트 루트에서:

```bash
bun examples/adapter-pattern/run.ts
```

예상 출력(값은 모델/전략 변경에 따라 달라질 수 있음):

```text
Adapter pattern example completed
- End time: 120s
- End money: ...
- End netWorth: ...
- Owned generators: ...
- Actions applied: ...
```

## 포인트

- 숫자 타입을 `number`에 고정하지 않고 `bigint`로 대체
- 결제/소비/누적은 엔진 인터페이스로만 동작
- 전략/시뮬레이터 코어는 숫자 타입과 독립적으로 재사용 가능

## 실무 적용 팁

- 매우 큰 수(초대형 idle 게임 스케일)에서는 `absLog10` 구현 품질이 중요
- `toNumber`는 휴리스틱 계산용 보조값으로만 사용
- 정밀도가 필요한 경우 `mul/div` 구현에서 부동소수점 경유를 줄이고 정수 연산 기반으로 개선
