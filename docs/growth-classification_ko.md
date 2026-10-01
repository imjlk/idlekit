# 성장 분류

영문 원문: [growth-classification.md](./growth-classification.md)

`analyzeGrowth`는 여전히 legacy 속도 버킷 `stall`, `softcap`, `exp`, `super-exp`를 반환한다. 그 이름은 log10 slope 임계값이다. 성장 형태가 아니고, 0에 가까운 버킷은 자원 병목이 아니다. `idk growth`와 experience snapshot은 그 보고서를 그대로 내므로 기존 KPI 출력은 유지된다.

`fitGrowth`는 별도 artifact다. sampling budget, method `growth-fit-v1`, method version 1, `windowSec`를 요구한다. `windowSec`는 시간 창이다. 표본 수가 1024 미만이어도 그 의미가 바뀌지 않는다. 형태와 속도는 다른 필드다. 형태는 관측 창의 후보인 `constant`, `polynomial`, `exponential`, `accelerating-log`, `saturating`, `unknown`이다. 후보는 점근 체제의 증명이 아니다.

양은 Engine에 남긴다. 양의 유한 값은 `absLog10`를 쓴다. `toNumber`는 절대 log10이 안전한 수 범위 안일 때만, 값 영역 잔차에만 쓴다. 0과 음수는 별도 domain이며 `abs`로 넘기지 않는다. 구매, reset, 부호 변화, 10배 하락은 새 창을 시작한다. 설정된 `analytic.softcap`은 형태 옆에 기록되고 형태를 고르지 않는다.

이후 Analyzer adapter는 `GrowthSamplingContract`를 넘기고 `GrowthFitArtifactV1`를 읽어야 한다. legacy enum으로 regime을 추론하지 않는다. 구조 schema는 `idlekit.growth-fit.v1`이다.

RNG는 없다. 수식과 실행한 시뮬레이션 케이스는 `fixtures/conformance/growth-shapes.json`이다. 재현 라벨은 그 파일이다. slope 허용 오차는 `1e-4`다.

Node.js와 브라우저 런타임은 v1 호환 계약에 포함되지 않는다.
