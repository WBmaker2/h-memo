# H Memo 시작 시 서버 최신 메모 확인 모달 구현 계획

## 승인 상태

- 사용자 승인: 2026-08-28
- 구현 범위: 웹 앱과 Tauri 데스크톱 앱의 시작 동기화 흐름
- 작업 방식: 계획 문서 저장 후 테스트 우선 구현
- 현재 단계: 구현 완료, 검증 완료

## 목표

앱이 처음 시작될 때 로컬 메모와 로그인한 사용자의 서버 최신 백업 요약을 비교합니다. 서버에만 새로운 변경이 확인되면 다음 메시지의 반응형 오버레이 모달을 표시합니다.

> 서버에 저장된 최근 버전의 메모를 불러오시겠습니까?

사용자는 마우스로 ‘예’ 또는 ‘아니요’를 선택할 수 있고, 모달이 대기 중일 때 Enter를 누르면 기본 동작으로 서버 최신본을 안전하게 복원합니다.

## 현재 구조와 재사용할 계약

- 서버 백업 요약은 `id`, `savedAt`, `memoCount`, `contentHash`, `schemaVersion`을 이미 포함합니다.
- 서버 저장 시각은 Firestore 서버 타임스탬프를 사용합니다.
- 웹과 데스크톱 모두 복원 전 안전 지점과 복원 잠금 경로가 있으므로 직접 배열을 덮어쓰지 않고 기존 경로를 재사용합니다.
- 웹은 시작 시 로컬이 비어 있을 때만 서버본을 자동 복원하고, 데스크톱은 현재 수동 백업 이력 복원만 제공합니다. 이 동작을 공통 판정 로직으로 교체합니다.

## 버전 비교 규칙

단순히 로컬 `updatedAt`과 서버 `savedAt`을 비교하지 않습니다. 클라이언트 시계 차이와 같은 콘텐츠의 재백업으로 인한 오탐을 막기 위해 콘텐츠 해시와 마지막 동기화 체크포인트를 우선 사용합니다.

로컬에는 메모 본문이 아닌 다음 메타데이터만 사용자 ID별로 저장합니다.

```ts
type LocalSyncCheckpoint = {
  version: 1;
  userId: string;
  snapshotId: string;
  contentHash: string;
  serverSavedAt: string | null;
  recordedAt: string;
};
```

판정 결과:

| 조건 | 결과 |
| --- | --- |
| 로그인 세션 또는 서버 사용 불가 | 팝업 없이 로컬 사용 |
| 로컬 해시와 서버 해시가 동일 | 동일 버전으로 처리하고 체크포인트 갱신 |
| 로컬 해시는 마지막 체크포인트와 같고 서버 스냅샷 ID만 변경 | 서버만 최신 → 확인 모달 |
| 서버 스냅샷 ID는 같고 로컬 해시만 변경 | 로컬 최신 → 로컬 사용, 자동 백업 가능 |
| 서버 ID와 로컬 해시가 모두 변경 | 충돌 → 자동 백업 중지, 수동 해결 안내 |
| 로컬이 비어 있고 유효한 서버본이 있음 | 자동 복원하지 않고 확인 모달 |
| 체크포인트가 없는 기존 설치 | 해시가 같으면 동일, 다르면 서버 `savedAt`과 로컬 `updatedAt`을 보조 비교 |
| 날짜 누락·형식 오류·알 수 없는 스키마 | 자동 복원하지 않고 수동 복원 안내 |

‘아니요’를 누르면 해당 실행 세션 동안 자동 백업을 중지합니다. 그렇지 않으면 사용자가 유지하기로 한 로컬본이 서버본을 즉시 덮어쓸 수 있습니다. 다음 실행 때 서버가 여전히 최신이면 다시 확인합니다.

복원 버튼을 누른 직후에는 서버 요약을 한 번 더 조회합니다. 모달이 열린 동안 서버나 다른 탭에서 변경되었다면 다시 판정하고, 양쪽 변경으로 바뀐 경우에는 복원을 중단합니다.

## 대상 파일과 모듈 경계

### 동기화 도메인

- 추가: `packages/memo-sync/src/startupVersionComparison.ts`
- 추가: `packages/memo-sync/src/startupVersionComparison.test.ts`
- 추가: `packages/memo-sync/src/localSyncCheckpoint.ts`
- 추가: `packages/memo-sync/src/localSyncCheckpoint.test.ts`
- 수정: 백업 게이트웨이 공개 타입과 인덱스
- 수정: 활성 스냅샷 요약 조회를 공개 게이트웨이에서 사용할 수 있도록 연결

### 공통 UI

- 추가: `packages/memo-ui/src/StartupServerRestoreDialog.tsx`
- 추가: `packages/memo-ui/src/StartupServerRestoreDialog.test.tsx`
- 추가 또는 수정: 공통 Dialog 스타일과 export

모달은 `<form>`과 `type="submit"`인 서버 복원 버튼을 사용합니다. 서버 복원 버튼에 초기 포커스를 주고, 진행 중 중복 제출을 막습니다. Escape는 대기 중일 때만 로컬 유지와 같은 동작으로 처리합니다.

### 웹 연결

- 추가: `apps/web/src/features/startup-sync/useWebStartupServerRestore.ts`
- 추가: `apps/web/src/WebApp.startupSync.test.tsx`
- 수정: `apps/web/src/WebApp.tsx`에는 로컬 로드·인증 완료 후 훅을 연결하는 최소 코드만 추가
- 수정: 자동 백업 상태가 `checking`, `prompting`, `declined`, `conflict`, `restoring`일 때 백업하지 않도록 게이트

### 데스크톱 연결

- 추가: `apps/desktop/src/features/startup-sync/useDesktopStartupServerRestore.ts`
- 추가: `apps/desktop/src/App.startupSync.test.tsx`
- 수정: `apps/desktop/src/App.tsx`에는 시작 훅 연결과 창 펼침 순서 제어만 추가

데스크톱에서는 현재 창 라벨이 `main`인 경우에만 시작 모달을 표시합니다. 개별 메모 창에는 모달을 표시하지 않습니다. 시작 판정이 완료될 때까지 저장된 메모 창의 자동 펼침을 잠시 보류합니다.

## UI/상호작용 요구사항

- 제목: `더 최근 서버 메모가 있습니다`
- 본문: `서버에 저장된 최근 버전의 메모를 불러오시겠습니까?`
- 로컬·서버 저장 시각과 메모 개수를 함께 표시
- `아니요, 로컬 유지`
- `예, 서버 메모 불러오기 ↵`
- 예 버튼에 초기 포커스
- Enter로 예 동작
- 마우스 클릭 지원
- Escape로 로컬 유지
- 진행 중 버튼 비활성화
- 복원 오류 시 로컬 변경 없이 재시도 가능
- `role="dialog"`, `aria-modal`, 제목·설명 연결, 진행 상태 알림
- 포커스 순환과 모달 종료 후 원래 포커스 복귀
- 너비 `min(440px, calc(100vw - 24px))`, 좁은 화면에서 버튼 세로 배치
- 44px 이상 터치 영역, 긴 내용의 내부 스크롤
- H Memo는 교육용 앱이 아니므로 `gi-pulse` 대신 정적인 기본 버튼 강조 사용
- VoiceOver 구현 및 검증은 제외하고 일반 키보드·시맨틱 DOM 검증만 수행

## 테스트 우선 순서

1. 비교 함수의 RED 테스트 작성
2. 비교 함수와 체크포인트 저장소 구현
3. 백업 게이트웨이 요약 조회 테스트
4. 모달 RED 테스트 작성
5. 모달 구현 및 키보드·반응형 동작 검증
6. 웹 시작 흐름 통합 테스트
7. 데스크톱 시작 흐름 통합 테스트
8. 전체 타입 검사·테스트·빌드

핵심 테스트 케이스:

- 서버 없음, 동일 해시, 서버만 변경, 로컬만 변경, 양쪽 변경 충돌
- 빈 로컬, 체크포인트 없는 기존 설치, 잘못된 날짜, 삭제된 메모의 수정 시각
- Enter·마우스 예·마우스 아니요·Escape·포커스 복귀·중복 제출
- 복원 중 서버 변경, 네트워크 실패, 스냅샷 검증 실패
- 웹 자동 백업 중지와 재개
- 데스크톱 main/자식 창 분리와 창 펼침 순서

## 수용 기준

- 서버가 최신인 경우에만 시작 모달이 표시됩니다.
- 동일 버전이나 로컬 최신인 경우 불필요한 모달이 표시되지 않습니다.
- 모달에서 Enter를 누르면 서버 최신본 복원이 시작됩니다.
- 복원 전 안전 지점이 생성되고, 스냅샷 검증 실패 시 로컬 데이터가 보존됩니다.
- ‘아니요’ 또는 충돌 상태에서 해당 세션의 자동 백업이 서버본을 덮지 않습니다.
- 웹과 데스크톱에서 동일한 판정 규칙과 사용자 문구를 사용합니다.
- 320px 폭에서도 모달과 두 버튼을 사용할 수 있습니다.
- 새 기능 코드가 기존 대형 파일을 불필요하게 비대하게 만들지 않습니다.
- 웹·데스크톱 업데이트 내역이 함께 갱신됩니다.

## 검증 명령

구현 후 다음 순서로 실행합니다.

```bash
npm test -- --pool=forks packages/memo-sync/src/startupVersionComparison.test.ts packages/memo-sync/src/localSyncCheckpoint.test.ts
npm test -- --pool=forks packages/memo-ui/src/StartupServerRestoreDialog.test.tsx
npm test -- --pool=forks apps/web/src/WebApp.startupSync.test.tsx apps/desktop/src/App.startupSync.test.tsx
npm run typecheck
npm test -- --pool=forks
npm run build -w apps/web
npm run build -w apps/desktop
npm run check:versions
```

수동 검증은 웹의 320×280·390×844·1280×800과 Tauri 데스크톱의 main/자식 창에서 수행합니다. 오프라인, 새로고침, 서버 변경 중 모달 유지, 키보드만 사용한 복원도 확인합니다.

## 위험과 대응

- 시계 오차: 서버 `savedAt`은 구형 설치의 보조 기준으로만 사용
- 덮어쓰기: 복원 전 안전 지점과 기존 복원 잠금 재사용
- 모달 표시 중 재변경: 복원 직전 서버 요약 재조회
- 자동 백업 경쟁: 시작 판정과 사용자 거절·충돌 상태에서 백업 게이트
- 대형 파일 증가: 비교·UI·플랫폼별 시작 훅을 별도 파일로 분리
- 서버 장애: 로컬 우선으로 즉시 진입하고 수동 복원 경로 유지

## 기록 계획

- 이 문서를 구현 기준으로 유지
- 구현 중 판정 변경이나 범위 변경을 `Implementation log`에 기록
- 테스트 명령과 결과를 `Verification log`에 기록
- 구현 후 승인 계획과 실제 변경을 비교하는 리뷰 기록 추가
- 사용자 기능 변경 날짜와 내용을 웹·데스크톱 `업데이트 내역`에 함께 추가
- 버전 변경이 필요할 경우 저장소의 자동 패치 버전 정책과 `npm run check:versions`를 따름

## Implementation log

- `packages/memo-sync`에 SHA-256 콘텐츠 해시를 우선하고 사용자별 체크포인트와 서버 저장 시각을 보조 기준으로 사용하는 시작 버전 비교 모듈을 추가했습니다. 서버 요약만 조회하는 최신 백업 계약과 Firestore 게이트웨이 연결도 추가했습니다.
- `packages/memo-ui`에 반응형 서버 최신본 확인 모달을 추가했습니다. 예 버튼 초기 포커스, Enter 제출, 마우스 선택, Escape 로컬 유지, Tab 포커스 순환, 원래 포커스 복귀, 중복 제출 방지, 오류 재시도, 320px 대응을 포함합니다.
- 웹과 Tauri 데스크톱 main 창에 시작 동기화 훅을 연결했습니다. 비교 중·확인 중·복원 중에는 편집/복원/백업 경쟁을 막고, 복원 전 기존 안전 지점·잠금 경로를 재사용합니다. 복원 직전 서버 요약을 재조회하여 변경 시 충돌을 중단합니다.
- ‘아니요’·충돌·알 수 없는 레거시 시각에서는 해당 실행 세션의 자동 백업을 중지하되, 사용자가 명시적으로 수동 백업/복원을 선택할 수 있도록 분리했습니다. 자식 메모 창과 브라우저 fallback 창은 시작 서버 조회를 실행하지 않습니다.
- 웹 랜딩과 공통 `MemoWorkspace`의 `업데이트 내역`에 2026-08-28 기능 기록을 함께 추가했습니다. 기존 테스트 목업은 새 시작 확인 흐름을 명시적으로 닫도록 조정했습니다.
- 계획 대비 실제 선택: 앱 통합부는 기존 페이지 API와의 호환성 및 날짜 범위/페이지 정렬을 유지하기 위해 `listBackupSnapshotSummaryPage(limit: 1)`로 최신 요약을 조회합니다. 별도로 `loadLatestBackupSnapshotSummary`와 Firestore active-summary 게이트웨이 메서드도 공개해 향후 호출부 전환을 열어 두었습니다.

## Verification log

- `npm test -- --pool=forks packages/memo-sync/src/startupVersionComparison.test.ts packages/memo-sync/src/localSyncCheckpoint.test.ts packages/memo-ui/src/StartupServerRestoreDialog.test.tsx apps/web/src/WebApp.startupSync.test.tsx apps/desktop/src/App.startupSync.test.tsx` → 5개 파일, 19개 테스트 통과
- `npm test -- --pool=forks packages/memo-sync/src/backup.public.test.ts -t 'loads only the latest backup summary'` → 1개 테스트 통과
- `npm run typecheck` → desktop, web(테스트 TS 설정 포함), memo-core, memo-sync, memo-ui 모두 통과
- `npm test -- --pool=forks` → 73개 파일 통과, 1개 스킵; 536개 테스트 통과, 11개 스킵
- `npm run build -w apps/web` → Vite production build 성공
- `npm run build -w apps/desktop` → Vite production build 성공
- `npm run check:versions` → 8개 버전 필드 모두 `1.0.6` 일치
- `git diff --check` → 공백/패치 오류 없음
- 빌드에서 기존과 동일하게 단일 JS 청크가 500 kB를 초과한다는 Vite 경고가 남아 있습니다. 이번 변경의 실패가 아니며 코드 분할은 별도 개선 과제로 남겼습니다.
- 구현 직후 기준으로 실제 Firebase 인증·Firestore 데이터, Tauri main/자식 창, 오프라인/동시 변경 수동 검증과 VoiceOver 검증은 실행하지 않았습니다. 이후 공개 Pages의 브라우저·반응형 검증은 아래 릴리스 기록에서 별도로 수행했습니다. VoiceOver는 저장소 지침에 따라 제외했습니다.
- 브라우저 QA에서 Playwright Firefox를 설치하고 권한 제한 없이 실행했습니다. 웹앱 `#/app`의 320×280·390×844·1280×800에서 `scrollWidth === clientWidth`(각 320·390·1280)를 확인했고, 메모 입력 후에도 가로 스크롤이 없었습니다. Tab으로 `메모 메뉴`에 도달하고 Enter로 메뉴를 열었으며, 랜딩의 `업데이트 기록`에서 2026-08-28 시작 동기화 항목을 확인했습니다. 콘솔은 Errors 0, Warnings 0이었습니다. 개발 서버·Playwright 세션·QA 산출물은 종료/정리했습니다.
- 릴리스 전 로컬 수용 사전 확인에서 `cargo clean` 후 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline`을 재실행해 Rust 37개 테스트가 통과했습니다. 첫 실패는 이전 체크아웃 경로를 가리키는 생성 산출물 때문이었고, 소스 변경 없이 생성 산출물만 재생성했습니다.
- `npm run check:firebase-env -- --require-desktop-oauth`는 필수 Firebase 클라이언트 키는 통과했지만 로컬에 데스크톱 Google OAuth 클라이언트 ID·시크릿이 없어 실패했습니다. `npm run test:firestore-rules`는 로컬 Java 런타임이 없어 실행되지 않았습니다. 두 검증은 릴리스 CI의 GitHub 시크릿·Temurin Java 환경에서 재확인합니다.

## Plan review

- 승인한 핵심 수용 기준(서버 최신일 때만 모달, Enter 기본 복원, 마우스/키보드 선택, 안전 지점, 자동 백업 게이트, 웹/데스크톱 문구 일치, 반응형 모달, 업데이트 내역)을 구현하고 자동 검증했습니다.
- 서버 요약/본문 검증 실패와 모달 중 서버 변경은 로컬을 덮지 않고 오류·충돌 상태로 남기도록 했습니다. 사용자는 기존 백업 이력 수동 복원으로 후속 조치를 할 수 있습니다.
- 버전 파일은 직접 수정하지 않습니다. 이 저장소의 정책에 따라 기능 브랜치 PR 검증 후 `main` CI가 성공하면 자동 patch 버전·태그·Windows/macOS/Pages 릴리스가 이어지도록 실행합니다.

## Release execution log

- `codex/startup-server-restore-prompt` 기능 브랜치를 생성했습니다. 기존 사용자 소유 미추적 파일(`.chatgpt2codex/`, `h-memo-public-menu-fix.png`, `img/`)은 릴리스 변경에서 제외합니다.
- 완료한 순서: 의도한 소스·테스트·이 문서만 명시적으로 스테이징하고 커밋한 뒤 origin에 푸시, PR CI와 Pages 미리보기 빌드를 확인했습니다.
- 완료한 순서: PR 통과 후 `main` 병합, `Auto Version and Tag`가 생성한 patch 버전·태그와 Windows/macOS/Pages 워크플로를 확인하고 공개 Pages의 실제 학습자 경로를 검증했습니다.
- 실제 실행: 커밋 `51f9d5365a68594ff7ff63cccf7b1c83bdea9788`을 `codex/startup-server-restore-prompt`에 푸시하고 [PR #47](https://github.com/WBmaker2/h-memo/pull/47)을 생성했습니다. PR의 공통 CI·Windows·macOS·Pages 미리보기 검증이 모두 통과했습니다.
- 실제 실행: PR을 `main`에 병합한 커밋은 `274fc1f59a7c8a01dc17e276e49d073964b0a8bb`이며, `main` CI와 `Auto Version and Tag`가 성공했습니다. 자동 릴리스 커밋 `de102f8793876c7c4edec7477dab35c73affa936`과 태그 `v1.0.7`이 생성되었습니다.
- 실제 실행: 태그 기반 [Web Pages Deploy](https://github.com/WBmaker2/h-memo/actions/runs/33176072446), [Windows Tauri Build](https://github.com/WBmaker2/h-memo/actions/runs/33176068369), [macOS Tauri Build](https://github.com/WBmaker2/h-memo/actions/runs/33176070437)가 모두 성공했습니다. Windows MSI/NSIS는 [H Memo v1.0.7 Release](https://github.com/WBmaker2/h-memo/releases/tag/v1.0.7)에 업로드되었습니다.
- 실제 실행: 공개 Pages [랜딩](https://wbmaker2.github.io/h-memo/)과 [웹앱](https://wbmaker2.github.io/h-memo/#/app)을 HTTP 200 및 Firefox로 확인했습니다. 랜딩 제목·`v1.0.7` 링크·업데이트 기록의 2026-08-28 항목을 확인했고, 앱 경로의 제목과 메모 화면을 확인했습니다. 320·390·1280px에서 `scrollWidth === clientWidth`였으며 콘솔 Errors 0, Warnings 0이었습니다.
- 남은 수동 수용: 실제 사용자 계정으로 Firestore에 서로 다른 버전의 백업을 준비한 뒤 서버 최신 모달에서 Enter 복원·아니요 유지·복원 오류 보존을 확인하는 시나리오는 계정/데이터 접근 승인이 필요합니다. VoiceOver 검증은 저장소 지침에 따라 제외했습니다.
