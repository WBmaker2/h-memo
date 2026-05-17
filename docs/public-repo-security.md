# 공개 저장소 보안 가이드

`H Memo`는 공개 저장소 운영 앱입니다. 아래 규칙은 출시 전·후로 함께 지켜야 할 공개 저장소 기본 보안 기준입니다.

## 1) 공개에 안전한 값 vs 실제 비밀

- Firebase 클라이언트 설정(`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_MEASUREMENT_ID`)은 브라우저 노출 가능한 **공개 안전 값**입니다.
- 반면 다음 값은 절대 커밋하거나 릴리스 빌드에 하드코딩하면 안 됩니다.
  - `.env`, `.env.local`, `.env.production` 같은 실환경 파일
  - 서비스 계정 키(JSON), `.pem`, `.key`, `id_rsa`, `pkcs12` 등 개인 키/인증서
  - OAuth client secret, refresh token, 개인 액세스 토큰

## 2) 데이터 보안 경계

- 데이터 접근 경계는 서버 인증 토큰이 아니라 Firestore/Auth 규칙입니다.
- `packages/memo-sync` 정책과 규칙에 맞춰 인증된 사용자 본인 데이터만 읽고 쓸 수 있어야 합니다.
- `.github` 설정만으로 접근 권한이 바뀌지 않으므로, 규칙 변경이 있으면 즉시 테스트(`scripts/firestore-rules-policy.test.ts`)와 정책 배포를 점검합니다.

## 3) 데스크톱 OAuth 정책

- 데스크톱 OAuth는 Desktop OAuth client ID + PKCE/loopback 방식으로 처리합니다.
- 운영 릴리스에서는 `GOOGLE_OAUTH_CLIENT_SECRET`을 바이너리에 주입하거나 Workflow env에 전달해서는 안 됩니다.
- 현재 구현에서는 `GOOGLE_OAUTH_CLIENT_SECRET` 의존을 제거했으므로, 기존 비밀이 저장소/워크플로에 남아 있다면 즉시 삭제 또는 회전(재발급) 처리합니다.

## 4) GitHub 저장소 보안 권장 설정

공개 저장소로서 아래 항목을 켭니다.

- Secret scanning
- Push protection
- Dependabot alerts
- Dependabot security updates

추가로 `.github/dependabot.yml`에서 npm 및 Cargo 의존성 업데이트 PR을 주기적으로 생성하도록 관리합니다. 보안 업데이트 자동 생성은 GitHub 저장소의 Dependabot security updates 설정을 별도로 켜야 합니다.

### Cargo/Tauri 예외

현재 Tauri 2는 Linux 전용 GTK/WebKitGTK 경로에서 `glib 0.18.x`를 간접 의존합니다. RustSec `RUSTSEC-2024-0429`의 안전 버전은 `glib >=0.20.0`이지만, 현재 Tauri GTK 스택에서는 Dependabot이 이 버전까지 자동 갱신할 수 없습니다. H Memo는 현재 Windows/macOS 배포물만 발행하므로 이 Linux 전용 경로는 사용자 배포물의 실행 경로가 아닙니다.

따라서 `.github/dependabot.yml`에서는 `glib` 자동 업데이트를 명시적으로 예외 처리합니다. 이 예외는 영구 면제가 아니라 추적 항목입니다. Tauri/GTK 계열 의존성이 `glib >=0.20.0`으로 이동하면 예외를 제거하고 Cargo 의존성 업데이트를 다시 허용해야 합니다.

## 5) 릴리스 발행 전 점검

릴리스/배포 전 다음을 확인합니다.

- `GOOGLE_OAUTH_CLIENT_SECRET` 문자열이 워크플로 `.github/workflows/*.yml`에 남아 있지 않은지 확인
- `VITE_GOOGLE_OAUTH_CLIENT_ID`가 데스크톱 빌드 환경 변수로만 필요한 곳에 전달되는지 확인
- `npm test` 및 `npm run typecheck` 통과
- `.github/dependabot.yml` 존재 및 활성 상태 확인
- Tauri GTK 계열 의존성이 `glib >=0.20.0`을 지원하는지 확인하고, 지원되면 `glib` Dependabot 예외 제거
- 공개 저장소 보안 문서에 링크가 유지되는지 확인

문제 발견 시 공개 설정, CI 보안 검사 스크립트, 릴리스 노트를 함께 갱신하고 다시 공개 릴리스 전 검증을 반복합니다.
