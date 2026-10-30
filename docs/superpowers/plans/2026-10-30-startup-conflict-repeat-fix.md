# 시작 충돌 반복 메시지 해소 구현 계획 (2026-10-30)

## 배경

- 프로그램 시작 시 로컬·서버 버전을 비교하고, 서버가 최신이면 확인창을 표시합니다.
- 로컬과 서버가 모두 바뀌면 `conflict`로 판단하고 자동 복원을 멈춘 뒤 백업 기록 비교를 안내합니다.
- 문제: `conflict` 상태에서 체크포인트를 갱신하지 않아 매 실행마다 같은 안내가 반복됩니다.
- 사용자 선택: 확인창 유지 + 반복만 수정, 충돌 해소는 서버 우선·로컬 백업.

## 원인 정리

- `packages/memo-sync/src/startupVersionComparison.ts`가 양쪽 변경을 `conflict`로 판정합니다.
- `useDesktopStartupServerRestore.ts`, `useWebStartupServerRestore.ts`의 `conflict` 분기는 체크포인트를 쓰지 않고 `phase="conflict"`로 끝납니다.
- 다음 실행 때도 같은 입력으로 다시 `conflict`가 됩니다. 자동 백업도 멈춘 채로 교착됩니다.
- 충돌 안내 UI(`StartupSyncNotice`)에는 다시 확인 버튼만 있어 해소 경로가 없습니다.

## 구현 범위

1. 진단 로그: 시작 비교 입력(해시 앞자리, 스냅샷 ID, 판정 결과)을 `console.debug`로 남깁니다.
2. 충돌 해소 액션:
   - `resolveConflictWithServer`: 로컬은 복원 안전 지점에 보관 후 서버 payload로 덮어쓰고 체크포인트 갱신.
   - `keepLocalAndSyncCheckpoint`: 현재 로컬 해시로 체크포인트 갱신 후 자동 백업 재개.
3. UI: 충돌 안내에 두 버튼 제공. 주 버튼(서버로 덮어쓰기)에 `btn-pulse` 적용.
4. 웹·데스크톱 훅과 안내 UI를 함께 수정하고, 기존 `server-newer` 확인창 동작은 유지합니다.
5. 단위·통합 테스트 추가 후 전체 검증합니다.

## 파일별 변경 예정

- `packages/memo-sync/src/startupVersionComparison.ts`: 진단 포맷 헬퍼 추가(판정 로직 유지).
- `apps/desktop/src/features/startup-sync/useDesktopStartupServerRestore.ts`: 충돌 서버 보관, 해소 콜백 2종 추가.
- `apps/web/src/features/startup-sync/useWebStartupServerRestore.ts`: 동일, 지문(fingerprint) 포함.
- `apps/desktop/src/features/startup-sync/StartupSyncNotice.tsx`: 해소 버튼 UI.
- `apps/web` 충돌 안내 사용처: 동일 UI 적용.
- `apps/desktop/src/styles.css`, `apps/web/src/styles.css`: `btn-pulse` 정의(금빛 링, reduced-motion 대응).
- `apps/desktop/src/App.startupSync.test.tsx`, `apps/web/src/WebApp.startupSync.test.tsx`: 해소 후 재실행 반복 없음 검증.
- `apps/web/src/landing/LandingPage.tsx`: 업데이트 기록에 이번 수정 추가.

## 검증

- `npm run check:versions`
- 관련 vitest 스위트 실행
- 충돌 → 서버 해소 → 재시작 시 메시지 미노출 수동 시나리오 확인

## 릴리스

- `npm run version:bump`로 patch 증가 후 `npm run check:versions` 재확인.
- 커밋·푸시·배포 후 홍보페이지(랜딩 업데이트 기록)에 최신 버전 내용 반영.
