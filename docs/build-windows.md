# Windows 빌드 및 패키징 가이드 (Tauri)

본 문서는 `apps/desktop`을 Windows 실행 파일/설치 프로그램 형태로 만들기 위한 가이드입니다.

## 1) 빌드 전제 조건

- Node.js + npm
- Windows 환경 (또는 GitHub Actions `windows-latest`)
- Tauri 빌드에 필요한 Rust/Cargo (로컬에서 `tauri build` 또는 `npm run tauri:build -w apps/desktop` 실행 시 필수)

## 2) 준비

```bash
npm ci
```

운영 배포판에는 H Memo용 Firebase Web Client 설정, `VITE_GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`이 내장되어야 구글 로그인/서버 백업 버튼이 활성화됩니다. Windows 데스크톱 로그인은 WebView 팝업이 아니라 시스템 기본 브라우저와 Desktop OAuth client의 로컬 loopback으로 완료됩니다. `GOOGLE_OAUTH_CLIENT_SECRET`은 GitHub Actions secret으로 주입하고 프론트엔드 `VITE_` 변수로 만들지 않습니다.
다른 Firebase 프로젝트로 테스트해야 할 때만 `.env.example`를 참고해 Vite 환경 변수를 지정하세요.

## 3) Windows 패키지 빌드

```bash
npm run tauri:build -w apps/desktop
```

빌드 전에는 먼저 버전 정합성을 확인하세요.

```bash
npm run check:versions
```

`apps/desktop/src-tauri/tauri.conf.json`에서 현재 번들 타깃은 아래와 같습니다.

- `nsis`
- `msi`

빌드 산출물은 다음 경로에 생성됩니다.

- `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`

GitHub Actions `windows-tauri.yml`에서는 Azure Artifact Signing 설정이 준비된 경우 위 MSI/NSIS 설치 파일을 업로드 전에 서명합니다. 태그 또는 수동 릴리스 빌드는 서명 구성이 없으면 실패하므로, 정식 배포 전에 [`docs/release.md`](./release.md)의 Azure Artifact Signing 설정을 먼저 완료하세요.

> 로컬 환경에서 `cargo`가 없으면 `npm run tauri:build -w apps/desktop`은 `cargo not found` 또는 유사 에러로 실패할 수 있습니다.  
> 이 경우 Windows Tauri 검증은 GitHub Actions 워크플로(`windows-tauri.yml`)로 대체하세요.

## 4) 로컬 확인 체크리스트

- 앱이 정상 실행되는지
- Windows 시스템 트레이에 노란 메모 모양의 H Memo 아이콘이 보이는지
- 설치 마법사(NSIS) 또는 MSI가 생성되는지
- 설치 후 실행/삭제가 되는지
- 구글 로그인 성공 표시와 여러 메모 서버 백업/복원 버튼 활성화가 동작하는지
- 기본 메모 생성/저장/삭제와 독립 창 기반 여러 메모 관리가 동작하는지
- TXT 내보내기와 JSON 백업/복원이 동작하는지

## 5) GitHub 릴리스

Windows 태그 릴리스 및 수동 릴리스 실행 방법은 [`docs/release.md`](./release.md)를 참고하세요.
