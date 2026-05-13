# 웹 확장 로드맵 (Task 5)

## 목표

- `desktop` 앱의 핵심 저장소/도메인 계층(`memo-core`)과 UI 계층(`memo-ui`), 동기화 계층(`memo-sync`)을 재사용해
  브라우저 미리보기 앱을 먼저 제공합니다.
- 최종적으로는 브라우저, 모바일(PWA/웹뷰), macOS 앱까지 동일한 멀티 플랫폼 방향으로 확장할 수 있는 기반을 마련합니다.

## 지금 반영한 범위 (web preview)

- `apps/web` 추가
  - Vite + React + TypeScript 진입점
  - `MemoWorkspace` 공통 쉘 컴포넌트를 사용해 데스크톱 앱과 레이아웃 구조 공유
  - localStorage 기반 저장소(`LocalStorageMemoRepository`) 사용
  - 서버 백업/시작프로그램 체크박스는 웹 미리보기 상태로 비활성 처리
- `packages/memo-ui`
  - `SettingsPanel`에 시작프로그램 토글 비활성화 옵션을 선택적으로 제어할 수 있는 `isStartupAvailable` 추가
  - 공통 뷰 쉘 컴포넌트 `MemoWorkspace` 추가 (`desktop-app`/`web-app` 클래스명으로 렌더링 가능)
- `README`
  - 웹 미리보기 경로/제약 사항 링크 추가

## 제한 사항

- 웹은 현재 `localStorage` 기반 저장소만 기본 동작합니다.
- 클라우드 백업/복원, Google 로그인, Tauri 전용 시작프로그램 등록은 지원하지 않습니다.
- 데스크톱 앱과 동일한 네이티브 파일 다이얼로그/윈도우 영속성은 제공되지 않습니다.

## 향후 확장 제안 (안전한 순차)

1. 웹 동기화 게이트웨이 플러그인화
   - Firebase/클라우드 연동을 선택적으로 넣는 웹 전용 sync 레이어 추가
2. 플랫폼별 빌드
   - 모바일은 동일한 web shell 기반으로 PWA 또는 웹뷰 래퍼 적용
3. macOS
   - Tauri를 확장해 macOS 런타임으로 포장 (현재 `desktop`은 Windows 중심 구성 참고)
4. 공통 상태 레이어 추상화
   - 플랫폼별 저장소/인증/백업 의존성을 적은 인젝션 구조로 정리
