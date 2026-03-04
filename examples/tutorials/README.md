# Tutorials Example Set (2트랙)

이 디렉터리는 `docs/tutorial-step-by-step.md`에서 사용하는 전용 예제 파일 모음입니다.

## 파일 구성

- `01-cafe-baseline.json`
  - 입문 트랙 기준 시나리오
  - 내장 `linear@1` + `greedy`
- `02-cafe-fast.json`
  - 같은 도메인에서 `sim.fast=true`, step/duration 변경
- `03-cafe-compare-b.json`
  - 비교용 대조군 시나리오
  - baseline 대비 cost/income 파라미터만 변경
- `04-cafe-tune.json`
  - baseline 시나리오에 적용하는 튜닝 스펙

## 권장 실행 순서

1. `01-cafe-baseline.json`으로 validate/simulate/eta/report
2. `03-cafe-compare-b.json`와 baseline 비교(compare)
3. `04-cafe-tune.json`으로 튜닝(tune)
4. `02-cafe-fast.json`으로 fast 모드 해석

## 기대 관찰 포인트

- baseline vs compare-b에서 `detail.source=measured` 기준 성능 차이
- tune 결과에서 `report.best`와 `top` 후보군 비교
- fast 모드에서 이벤트 수 감소/처리 속도 향상 경향
