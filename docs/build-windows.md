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

운영 배포판에는 H Memo용 Firebase Web Client 설정이 내장되어 있어 별도 `.env` 없이 구글 로그인/서버 백업 버튼이 활성화됩니다.
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

> 로컬 환경에서 `cargo`가 없으면 `npm run tauri:build -w apps/desktop`은 `cargo not found` 또는 유사 에러로 실패할 수 있습니다.  
> 이 경우 Windows Tauri 검증은 GitHub Actions 워크플로(`windows-tauri.yml`)로 대체하세요.

## 4) 로컬 확인 체크리스트

- 앱이 정상 실행되는지
- 설치 마법사(NSIS) 또는 MSI가 생성되는지
- 설치 후 실행/삭제가 되는지
- 구글 로그인 성공 표시와 여러 메모 서버 백업/복원 버튼 활성화가 동작하는지
- 기본 메모 생성/저장/삭제와 독립 창 기반 여러 메모 관리가 동작하는지
- TXT 내보내기와 JSON 백업/복원이 동작하는지

## 5) GitHub 릴리스

Windows 태그 릴리스 및 수동 릴리스 실행 방법은 [`docs/release.md`](./release.md)를 참고하세요.
