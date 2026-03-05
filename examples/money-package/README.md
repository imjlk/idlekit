# Money Package Example

`@idlekit/money`를 단독으로 사용하는 실행 예제입니다.

## 실행

프로젝트 루트에서:

```bash
bun examples/money-package/run.ts
```

## 예제에서 확인하는 항목

- `tickMoney` accumulate 정책(`queued` -> `flushed`)
- `formatMoney`/`parseMoney`
- `VisibilityTracker` 표시 변화 감지
- `serializeMoneyState`/`deserializeMoneyState`

## 참고

- 상세 문서: `docs/money-library.md`
- 커스텀 엔진 어댑터: `examples/adapter-pattern`
