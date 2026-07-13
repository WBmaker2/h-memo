# H Memo Automatic Version and Release Plan

**Date:** 2026-07-13

## Goals

- `main`에 실제 변경이 반영되고 CI가 성공할 때마다 패치 버전을 자동으로 올립니다.
- 예: `1.0.0` 다음 변경은 `1.0.1`, 그다음 변경은 `1.0.2`가 됩니다.
- 새 버전 태그에서 Windows Release, macOS 내부 테스트 아티팩트, GitHub Pages를 자동으로 생성합니다.
- 웹앱의 Windows 다운로드 버튼은 최신 GitHub Release의 MSI와 EXE를 계속 자동으로 가리키게 합니다.
- 자동 버전 정책을 저장소 문서와 `AGENTS.md`에 기록해 이후 작업에서도 유지합니다.

## Current Download Verification

- 배포 주소: `https://wbmaker2.github.io/h-memo/`
- Windows EXE: 최신 Release `v1.0.0`의 `H.Memo_1.0.0_x64-setup.exe`로 연결되며 HTTP 200 응답을 확인했습니다.
- Windows MSI: 최신 Release `v1.0.0`의 `H.Memo_1.0.0_x64_en-US.msi`로 연결되며 HTTP 200 응답을 확인했습니다.
- macOS: 공개 서명 제약 때문에 고정된 내부 테스트용 `v0.1.2` Apple Silicon DMG로 연결되며 HTTP 200 응답을 확인했습니다.

## Automation Design

1. 기존 CI는 PR과 `main` 변경을 검증합니다.
2. 새 `Auto Version and Tag` 워크플로는 `main`의 CI가 성공한 경우에만 실행합니다.
3. 자동 버전 커밋과 이미 처리한 원본 커밋은 다시 처리하지 않아 무한 루프와 중복 증가를 막습니다.
4. 버전 스크립트는 루트·워크스페이스 package 파일, 내부 패키지 의존성, `package-lock.json`, Tauri 설정, Cargo 패키지 버전을 구조적으로 함께 갱신합니다.
5. 자동 커밋에는 원본 커밋 SHA를 기록하고 `vX.Y.Z` 태그를 푸시합니다.
6. Windows, macOS, Pages 워크플로는 PR 검증과 버전 태그 배포를 담당하며 `main` 변경에서 중복 네이티브 빌드를 만들지 않습니다.
7. Windows 태그 빌드는 MSI와 EXE를 GitHub Release에 게시합니다. 웹앱은 최신 Release API를 사용하므로 별도 하드코딩 없이 새 파일을 가리킵니다.

## Safety

- CI 실패 시 버전과 태그를 만들지 않습니다.
- 동시 변경은 concurrency 그룹으로 직렬화합니다.
- 같은 원본 커밋의 CI를 재실행해도 `Source-Commit` 기록을 확인해 버전을 다시 올리지 않습니다.
- 태그가 이미 존재하면 실패로 처리하여 기존 Release를 덮어쓰지 않습니다.
- 자동 버전 스크립트와 워크플로 동작을 단위 테스트와 정적 워크플로 테스트로 검증합니다.

## Verification and Delivery

1. 버전 증가 스크립트의 정상·오류·내부 의존성·lockfile 갱신 테스트를 실행합니다.
2. 자동 버전 워크플로의 권한, CI 성공 조건, 중복 방지, 태그 푸시 조건을 테스트합니다.
3. 전체 테스트, 타입 검사, 웹·데스크톱 빌드, Rust 테스트와 Clippy를 실행합니다.
4. PR 검사를 통과시켜 `main`에 병합합니다.
5. 자동 생성된 다음 패치 버전, 태그, GitHub Release, Windows/macOS 아티팩트, Pages 배포를 확인합니다.
