# Task 2 보고서

## 상태

완료

KST 달력 날짜 계산과 백업 콘텐츠 지문·미리보기 유틸리티를 구현했습니다.

## 변경 파일

- `packages/memo-sync/src/backupKstDate.ts`
  - `Asia/Seoul` 기준 날짜 키 변환
  - 오늘 포함 365일 보존 시작일 계산
  - 달력 날짜 기반 범위 판정
- `packages/memo-sync/src/backupKstDate.test.ts`
  - KST 자정 경계, 365일 범위, 윤년 2월 테스트
- `packages/memo-sync/src/backupFingerprint.ts`
  - 삭제되지 않은 메모만 대상으로 한 SHA-256 콘텐츠 hash
  - payload `createdAt`, 메모 순서, `syncState` 비반영
  - 최대 240자 미리보기 생성
- `packages/memo-sync/src/backupFingerprint.test.ts`
  - hash 무시·반영 조건과 미리보기 길이 테스트

새 구현·테스트 파일은 모두 500줄 미만입니다.

## 커밋

- `69df2f5 feat: add KST backup dates and fingerprints`
- `docs: record KST backup task 2 report` (이 보고서)

## 테스트 명령 및 실제 결과

- `npm test -- packages/memo-sync/src/backupKstDate.test.ts packages/memo-sync/src/backupFingerprint.test.ts --pool=forks`
  - 통과: 2개 테스트 파일, 8개 테스트
- `npm run typecheck -w packages/memo-sync`
  - 통과: TypeScript 오류 없음

## 자체 검토

- KST 날짜는 `Intl.DateTimeFormat(...).formatToParts()`로 연·월·일을 조합합니다.
- 보존 기간은 24시간 차감이 아니라 UTC 날짜 연산으로 KST 날짜 키를 이동합니다.
- hash 입력은 삭제되지 않은 메모를 ID로 정렬하고 객체 키를 재귀적으로 정렬합니다.
- 삭제된 메모의 변경은 hash와 미리보기에 영향을 주지 않으며, 복원되는 메모 필드 변경은 hash에 반영됩니다.
- `git diff --check`를 통과했고, 사용자 자료 `h-memo-public-menu-fix.png`와 `img/`는 변경하지 않았습니다.

## 우려사항

현재 확인된 기능상 우려사항은 없습니다. hash 함수는 실행 환경에서 표준 Web Crypto의 `crypto.subtle`과 `TextEncoder`를 제공한다는 전제에 의존합니다.
