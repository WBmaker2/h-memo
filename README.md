# H Memo

H Memo는 Tauri 2 + React + TypeScript로 만든 데스크톱/웹 메모 앱입니다.
공통 메모 도메인과 UI는 워크스페이스 패키지에 두고, `apps/desktop`에서 플랫폼 실행 로직만 처리합니다.

## 모노레포 구조

- `apps/desktop`: Tauri 데스크톱 앱(PWA/UI 진입점 포함)
- `apps/web`: 공유 DB 웹앱 (브라우저 기반 Firebase Auth/Firestore 백업/복원)
- `packages/memo-core`: 메모 모델/저장소 타입/백업 payload 생성 및 포맷 유틸
- `packages/memo-ui`: 메모 화면, 툴바, 설정 UI 컴포넌트
- `packages/memo-sync`: Firebase Auth/Firestore 백업 게이트웨이

## 주요 스크립트

```bash
npm ci                      # 의존성 설치
npm run dev                 # 앱 실행 (apps/desktop)
npm run test                # 전체 워크스페이스 테스트
npm run typecheck           # 전체 워크스페이스 타입체크
npm run build               # 전체 워크스페이스 빌드
npm run build -w apps/desktop # desktop 패키지 단독 빌드
npm run build -w apps/web     # 공유 DB 웹앱 패키지 단독 빌드
npm run tauri:dev            # Tauri 개발 실행
npm run tauri:build          # Tauri Windows/MSI/NSIS 빌드 시도
npm run tauri:build:macos    # macOS 내부 테스트용 .app/.dmg 빌드
```

## 로컬 개발 가이드

```bash
npm ci
npm run dev
```

### Firebase 환경 변수

기본 배포판은 H Memo용 Firebase Web Client 설정을 내장합니다. Windows/macOS 데스크톱 Google 로그인은 시스템 기본 브라우저와 로컬 loopback을 사용하는 **Desktop app** OAuth 흐름이므로, 운영 빌드에는 `VITE_GOOGLE_OAUTH_CLIENT_ID`만 주입하면 됩니다. 다른 Firebase 프로젝트로 개발/스테이징 테스트를 할 때는 [`docs/firebase-setup.md`](./docs/firebase-setup.md) 또는 `.env.example`를 참고해 환경 변수를 지정하세요.
운영 배포판은 H Memo용 Firebase Web Client 설정과 Desktop OAuth client ID를 내장해 사용자가 `구글 로그인`만으로 백업/복원을 시작할 수 있게 합니다. OAuth client secret은 더 이상 배포본에 주입하지 않습니다.
내장/빌드 설정이 모두 비어 있는 개발 빌드에서만 앱 메뉴의 `구글 로그인 설정` 입력 폼이 나타납니다.

## Web App

- `apps/web`은 데스크톱 앱과 동일한 Firebase Auth + Firestore 백업 DB를 사용합니다.
- 로컬 실행/빌드:
  - `npm ci`
  - `npm run build -w apps/web`
  - `npm run dev -w apps/web` (Vite 개발 서버는 `127.0.0.1`에서 실행)
- 공유 DB 경로: `users/{uid}/backupSnapshots/{snapshotId}`, `users/{uid}/serverMemoDeletes/{memoId}`
- 첫 공유 웹 릴리스는 명시적으로 서버 백업/복원과 서버 메모 관리를 사용하며, 실시간 per-memo sync는 이후 `users/{uid}/memos/{memoId}` 모델로 이전할 예정입니다.

## 테스트/타입체크/빌드

```bash
npm test
npm run typecheck
npm run build -w apps/desktop
npm run build -w apps/web
npm run check:versions
```

## 현재 지원 기능

- Windows 앱에서는 여러 개의 포스트잇 메모를 각각 독립 창으로 만들고, 앱을 다시 실행해도 마지막 내용과 위치/크기를 유지합니다.
- macOS 앱은 내부 테스트용 `.app`/`.dmg` 빌드를 지원합니다. Apple Developer ID 서명/공증은 아직 적용하지 않았습니다.
- 메모별 메뉴에서 색상, 글꼴, 글자 크기, 글자색을 조절하고 필요 없는 메모를 삭제할 수 있습니다.
- 앱 메뉴의 `메모 관리`에서 여러 메모를 한꺼번에 확인하고, 독립 창으로 열거나 삭제할 수 있습니다.
- `TXT 내보내기`로 현재 메모 내용을 로컬 텍스트 파일로 저장할 수 있습니다.
- `JSON 백업` / `JSON 복원`으로 여러 메모 전체를 로컬 파일로 백업하고, 복원 전 확인 후 되돌릴 수 있습니다.
- Firebase 설정이 유효하면 `구글 로그인` 후 여러 메모 전체를 서버에 백업/복원할 수 있습니다.

## 공유 DB 웹앱 확장 경로

- [`docs/web-roadmap.md`](./docs/web-roadmap.md)
- [`docs/cross-platform-sync-roadmap.md`](./docs/cross-platform-sync-roadmap.md)

## 홍보 페이지와 웹 미리보기

- 웹 루트는 H Memo 소개/다운로드 페이지입니다.
- 기존 브라우저 메모 미리보기는 `#/app`에서 확인할 수 있습니다.
- 공개 홍보 페이지는 이 private repo에서 빌드한 정적 파일을 public `WBmaker2/h-memo-releases` repo의 GitHub Pages에 배포합니다.
- 공개 다운로드 버튼은 public `WBmaker2/h-memo-releases`의 최신 릴리스에서 Windows `.msi`를 우선 찾고, 없으면 `.exe`를 사용합니다.
- macOS 다운로드 버튼은 `https://github.com/WBmaker2/h-memo/releases/download/v0.1.2/H.Memo_0.1.2_aarch64.dmg` DMG 파일로 연결합니다.
- 웹앱 실행 버튼은 `https://wbmaker2.github.io/h-memo/` 공개 웹앱으로 연결합니다.
- 공개 웹앱 배포는 `H_MEMO_WEB_BASE_PATH=/h-memo/ VITE_H_MEMO_WEB_DEFAULT_ROUTE=app npm run build -w apps/web`처럼 루트를 웹앱으로 여는 빌드 플래그를 사용합니다.
- 최신 릴리스 API를 사용할 수 없을 때는 public Pages의 `download-manifest.json`을 fallback으로 사용하며, 그래도 설치 파일 URL이 없으면 버튼을 비활성 상태로 유지합니다.

### 웹 앱 동기화 상태

- Firebase 설정이 내장되었거나 환경 변수로 제공되면 웹 앱에서 구글 로그인 후 서버 백업/복원이 동작합니다.
- 시작프로그램 등록은 웹에서 계속 비활성 상태로 유지됩니다.

### Tauri 빌드

Windows/macOS 패키징은 Rust/Cargo가 필요합니다.
로컬에서 현재 환경에 cargo가 없으면 Tauri 빌드가 실패할 수 있으므로, GitHub Actions에서 검증하는 것을 권장합니다.

```bash
# Rust/Cargo 설치 후 실행
npm run tauri:build -w apps/desktop
npm run tauri:build:macos
```

## 패키징/배포 문서

- [`docs/build-windows.md`](./docs/build-windows.md)
- [`docs/build-macos.md`](./docs/build-macos.md)
- [`docs/firebase-setup.md`](./docs/firebase-setup.md)
- GitHub Actions
  - [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
  - [`.github/workflows/windows-tauri.yml`](.github/workflows/windows-tauri.yml)
  - [`.github/workflows/macos-tauri.yml`](.github/workflows/macos-tauri.yml)
  - [`docs/release.md`](./docs/release.md)
- 공개 저장소 보안 가이드: [`docs/public-repo-security.md`](./docs/public-repo-security.md)
