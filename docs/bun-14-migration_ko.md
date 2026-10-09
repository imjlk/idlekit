# Bun 1.4.2 및 Gunshi CLI로 마이그레이션

English version: [bun-14-migration.md](./bun-14-migration.md)

다음 릴리즈부터 `@idlekit/money`, `@idlekit/core`, `@idlekit/cli`는 Bun `>=1.4.2`를 요구합니다. Bun 1.3 지원은 종료됩니다. 새 패키지를 설치하기 전에 런타임을 올리세요. 아직 런타임을 올릴 수 없는 환경은 이미 설치한 이전 패키지 버전과 lockfile을 유지하고, 업그레이드할 수 있을 때 마이그레이션하세요.

## 런타임 업그레이드

Bun 설치 방식에 맞게 업그레이드하세요. Bun 설치 스크립트로 설치했다면 `bun upgrade`, Homebrew라면 `brew upgrade bun`, Scoop이라면 `scoop update bun`을 사용합니다. 특정 버전 설치 방법은 [Bun 공식 설치 안내](https://bun.com/docs/installation#upgrading)에서 확인할 수 있습니다.

Windows PATH를 변경했다면 새 터미널을 열고, 실제 애플리케이션을 시작하는 환경에서 `bun --version`을 실행하세요. 결과는 1.4.2 이상이어야 합니다. 버전 관리자와 CI의 pin도 함께 변경하세요. 이 저장소는 Linux와 Windows에서 Bun 1.4.2를 검증합니다.

저장소에서 작업한다면 해당 런타임을 활성화한 뒤 실행하세요.

```bash
bun install --frozen-lockfile
bun run toolchain:doctor
```

패키지를 사용하는 애플리케이션은 Bun을 먼저 올린 뒤 패키지 의존성과 lockfile을 갱신하고 테스트하세요. 전역으로 설치한 `idk`도 업그레이드한 Bun 런타임으로 갱신하세요.

## CLI 연동 변경

`review evaluate`, `review compare`, `review doctor`는 이제 Markdown 보고서를 출력합니다. 자동화에서 구조화된 출력이 필요하면 `--format json`을 사용하세요. OpenTUI 대시보드, 이미지 미리보기, `--image-mode` / `--image-protocol` 플래그는 제거되었으므로 스크립트에서도 해당 플래그를 제거하세요.

Gunshi는 알 수 없는 옵션을 검증하고 오타를 제안합니다. `idk --help`와 각 명령의 `--help`로 기존 스크립트를 확인한 뒤 시나리오 검증과 관련 보고서를 다시 실행하세요.

`idk setup completions --shell <shell>`로 셸 연동을 갱신하세요. `bash`, `zsh`, `fish`, `powershell`을 지원합니다. `idk complete <shell>`은 native completion 스크립트를 출력합니다.

## 릴리즈 검토

지원 하한 변경은 호환성 범위를 좁힙니다. 관리자는 이번 마이그레이션의 `minor` bump를 승인했으며, changeset은 [릴리즈 절차](./release-process_ko.md)에 이 결정을 세 패키지에 대해 기록합니다. 릴리즈 PR을 승인하기 전에 이 마이그레이션 안내와 생성된 릴리즈 계획을 검토하세요.
