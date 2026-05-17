# 웹 확장 로드맵 (Task 5)

## 목표

- `desktop` 앱의 핵심 저장소/도메인 계층(`memo-core`)과 UI 계층(`memo-ui`), 동기화 계층(`memo-sync`)을 재사용해
  브라우저 기반의 공유 DB 웹앱을 제공합니다.
- 최종적으로는 브라우저, 모바일(PWA/웹뷰), macOS 앱까지 동일한 멀티 플랫폼 방향으로 확장할 수 있는 기반을 마련합니다.

## 지금 반영한 범위 (공유 DB 웹앱)

- `apps/web` 추가
  - Vite + React + TypeScript 진입점
  - `MemoWorkspace` 공통 쉘 컴포넌트를 사용해 데스크톱 앱과 레이아웃 구조 공유
  - localStorage 기반 저장소(`LocalStorageMemoRepository`) 사용
  - Firebase 설정이 있을 때 웹에서도 구글 로그인/세션 복구 기반 서버 백업/복원 동작
  - 여러 메모 생성/관리 및 JSON 백업/복원 동작
  - 시작프로그램 토글은 웹에서 계속 비활성 처리
- PWA 준비
  - `manifest.webmanifest`, `sw.js`, `registerServiceWorker` 유틸, 아이콘 목록을 포함해 설치 가능한 첫 PWA 기반 구성 완료
  - PWA 매니페스트와 서비스워커 경로는 Vite `BASE_URL` 기준으로 상대 경로/루트 독립적으로 계산되도록 정리
- `packages/memo-ui`
  - `SettingsPanel`에 시작프로그램 토글 비활성화 옵션을 선택적으로 제어할 수 있는 `isStartupAvailable` 추가
  - 공통 뷰 쉘 컴포넌트 `MemoWorkspace` 추가 (`desktop-app`/`web-app` 클래스명으로 렌더링 가능)
- `README`
  - 웹앱 범위/운영 제약 링크 추가
- `apps/web` (공유 DB 웹앱)
  - 서버 메모 목록 조회/복원/삭제 흐름(`ServerMemoManagerDialog`) 동작 반영

## 제한 사항

- 웹은 기본은 `localStorage` 기반 저장소 동작입니다.
- Firebase 설정이 유효한 경우 로그인 후 서버 백업/복원이 가능하며, 시작프로그램 등록은 웹에서 지원하지 않습니다.
- 데스크톱 앱과 동일한 네이티브 파일 다이얼로그/윈도우 영속성은 제공되지 않습니다. 웹에서는 브라우저 다운로드/파일 선택으로 JSON 백업/복원을 처리합니다.

## 향후 확장 제안 (안전한 순차)

1. 웹 동기화 게이트웨이 플러그인화
   - Firebase/클라우드 연동을 선택적으로 넣는 웹 전용 sync 레이어 추가
   - Windows/macOS/web 공용 DB 전환 설계는 [`cross-platform-sync-roadmap.md`](./cross-platform-sync-roadmap.md)를 기준으로 진행
2. 플랫폼별 빌드
   - 모바일은 동일한 web shell 기반으로 PWA 또는 웹뷰 래퍼 적용
3. macOS
   - Tauri를 확장해 macOS 런타임으로 포장 (현재 `desktop`은 Windows 중심 구성 참고)
4. 공통 상태 레이어 추상화
   - 플랫폼별 저장소/인증/백업 의존성을 적은 인젝션 구조로 정리
