# H Memo KST Display and CI Redeploy Plan

**Date:** 2026-07-13

## Goal

- 모든 사용자 화면의 날짜와 시각을 실행 PC 및 CI 운영체제 시간대와 무관하게 `Asia/Seoul` 기준으로 표시합니다.
- UTC로 실행되는 GitHub Actions 테스트 실패를 제거합니다.
- 수정 후 CI, Windows Tauri Build, macOS Tauri Build, Web Pages Deploy를 다시 실행하고 결과를 확인합니다.

## Root Cause

- 공용 `formatDateTime` 함수는 선택적 `timeZone` 인자를 지원하지만 기본값이 없습니다.
- 호출부 대부분이 시간대를 전달하지 않아 macOS 한국 시간 환경에서는 KST로, GitHub Actions의 UTC 환경에서는 UTC로 표시됩니다.
- 테스트는 KST 표시를 기대하므로 네 개 워크플로가 공통 `npm test` 단계에서 실패하고 실제 빌드 및 Pages 배포가 중단됐습니다.

## Implementation

1. 공용 날짜 포맷 함수의 기본 시간대를 `Asia/Seoul`로 고정합니다.
2. 명시적인 다른 시간대를 전달하는 기존 확장성은 유지합니다.
3. UTC 환경에서도 KST 결과가 나오는 회귀 테스트와 명시적 시간대 재정의 테스트를 보강합니다.
4. 웹앱과 데스크톱 앱의 업데이트 내역에 KST 표시 안정화 내용을 기록합니다.
5. 관련 파일이 500줄을 넘기지 않도록 기존 작은 공용 모듈과 업데이트 데이터 파일만 수정합니다.

## Verification and Delivery

1. `TZ=UTC` 조건에서 날짜 포맷 관련 집중 테스트를 실행합니다.
2. 전체 TypeScript 테스트, 타입 검사, 데스크톱/웹 프로덕션 빌드를 실행합니다.
3. Rust 테스트와 Clippy를 실행합니다.
4. 변경을 커밋하고 원격 브랜치에 푸시한 뒤 PR을 생성·병합합니다.
5. 병합 커밋의 CI, Windows, macOS, Pages 워크플로가 모두 성공하는지 확인합니다.

