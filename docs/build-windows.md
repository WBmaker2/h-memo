# Windows 빌드 및 패키징 가이드 (Tauri)

본 문서는 `apps/desktop`을 Windows 실행 파일/설치 프로그램 형태로 만들고, 유료 Windows 인증서 없이 Tauri updater로 업데이트하는 방법을 설명합니다.

## 1) 빌드 전제 조건

- Node.js + npm
- Windows 환경 (또는 GitHub Actions `windows-latest` 계열 runner)
- Tauri 빌드에 필요한 Rust/Cargo
- release를 만들 때만 Tauri updater 개인 키와 공개 키

Tauri updater 서명은 Windows Authenticode/게시자 인증서와 다른 암호화 서명입니다. 이 프로젝트는 전자만 사용하므로 Authenticode 인증서 비용은 발생하지 않지만, Windows SmartScreen의 게시자 신뢰 경고가 사라지는 것은 아닙니다.

## 2) 준비

```bash
npm ci
```

운영 배포판에는 H Memo용 Firebase Web Client 설정, `VITE_GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`이 내장되어야 구글 로그인/서버 백업 버튼이 활성화됩니다. Windows/macOS 데스크톱 로그인은 WebView 팝업이 아니라 시스템 기본 브라우저와 Desktop OAuth client의 PKCE + 로컬 loopback으로 완료됩니다.
`GOOGLE_OAUTH_CLIENT_SECRET`은 GitHub Actions secret으로만 관리합니다. 설치형 앱에서는 이 값이 추출될 수 있으므로 별도의 서버 비밀이나 데이터 접근 권한으로 사용하지 않습니다.
다른 Firebase 프로젝트로 테스트해야 할 때만 `.env.example`를 참고해 Vite 환경 변수를 지정하세요.

## 3) Windows 패키지 빌드

```bash
npm run check:versions
npm run tauri:build:windows -w apps/desktop
```

일반 로컬/PR 빌드는 개인 키를 사용하지 않는 unsigned 검증용 설치 파일을 생성합니다. `tauri.conf.json`의 `createUpdaterArtifacts`가 기본적으로 꺼져 있기 때문입니다.

`apps/desktop/src-tauri/tauri.conf.json`에서 현재 번들 타깃은 아래와 같습니다.

- `nsis`
- `msi`

빌드 산출물은 다음 경로에 생성됩니다.

- `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`

> 로컬 환경에서 `cargo`가 없으면 `npm run tauri:build:windows -w apps/desktop`은 `cargo not found` 또는 유사 에러로 실패할 수 있습니다. 이 경우 Windows Tauri 검증은 GitHub Actions 워크플로로 대체하세요.

## 4) 무료 Tauri updater 서명 릴리스

업데이트 payload에는 Authenticode 인증서가 아니라 Tauri updater용 개인 키로 만든 detached `.sig`가 붙습니다. release workflow만 다음 config override를 사용합니다.

```text
bundle.createUpdaterArtifacts = true
```

Windows release에는 다음 파일이 생성되어야 합니다.

- `*.msi`
- `*.msi.sig`
- `*.exe`
- `*.exe.sig`

updater manifest인 `latest.json`은 MSI와 `*.msi.sig` 내용을 조합해 release job에서 자동 생성됩니다. 서명 파일의 경로가 아니라 서명 파일의 실제 텍스트가 manifest에 들어갑니다.

### 키를 처음 준비할 때

개발 PC에서 Tauri CLI로 키 쌍을 한 번 생성합니다.

```bash
npm exec -- tauri signer generate -w ~/.tauri/h-memo-updater.key
```

CLI가 보여 주는 공개 키는 다음 GitHub Actions Variable에 등록합니다.

```text
TAURI_UPDATER_PUBLIC_KEY
```

생성된 개인 키 파일의 내용은 GitHub Actions Secret에 `TAURI_SIGNING_PRIVATE_KEY`라는 이름으로 등록합니다. 선택적으로 개인 키 비밀번호를 사용하면 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` Secret도 등록합니다.

개인 키는 저장소, 문서, 로그, GitHub artifact에 기록하지 마세요. 개인 키를 잃으면 이미 설치된 사용자를 같은 updater 신뢰 체계로 업데이트할 수 없습니다.

### GitHub Actions 릴리스

`Windows Tauri Build`를 release tag 또는 `release_tag`가 지정된 workflow dispatch로 실행합니다. release job은 다음 순서로 동작합니다.

1. `TAURI_SIGNING_PRIVATE_KEY`와 `TAURI_UPDATER_PUBLIC_KEY`가 있는지 확인합니다.
2. Tauri가 MSI/NSIS와 각 updater `.sig`를 생성합니다.
3. MSI signature를 읽어 Windows `latest.json`을 생성합니다.
4. MSI, MSI signature, NSIS, NSIS signature, `latest.json`을 GitHub Release에 게시합니다.

Azure login, OIDC `id-token`, Authenticode 인증서, `verify-windows-signatures.ps1`는 현재 release 경로에서 사용하지 않습니다.

## 5) 로컬 확인 체크리스트

- 앱이 정상 실행되는지
- Windows 시스템 트레이에 노란 메모 모양의 H Memo 아이콘이 보이는지
- 설치 마법사(NSIS) 또는 MSI가 생성되는지
- 설치 후 실행/삭제가 되는지
- 새 release가 있을 때 시작 후 업데이트 확인 대화상자가 표시되는지
- `나중에`를 누르면 현재 앱을 계속 사용할 수 있는지
- `업데이트`를 누르면 기존 프로그램을 먼저 삭제하지 않고 설치가 시작되는지
- 구글 로그인 성공 표시와 여러 메모 서버 백업/복원 버튼 활성화가 동작하는지
- 기본 메모 생성/저장/삭제와 독립 창 기반 여러 메모 관리가 동작하는지
- TXT 내보내기와 JSON 백업/복원이 동작하는지

서명 없는 설치 파일은 Windows에서 SmartScreen 경고가 표시될 수 있습니다. 이것은 Tauri updater signature가 위조/변조 payload를 거부하는 것과 별개의 Windows 게시자 신뢰 문제입니다.

## 6) GitHub 릴리스

Windows 태그 릴리스 및 수동 릴리스 실행 방법은 [`docs/release.md`](./release.md)를 참고하세요. macOS 내부 테스트 빌드는 [`docs/build-macos.md`](./build-macos.md)를 참고하세요.
