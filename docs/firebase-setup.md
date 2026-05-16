# Firebase / 구글 로그인 설정 가이드

이 앱은 Firebase Web Client 설정을 이용해 구글 로그인을 기반으로 백업 기능을 제공합니다. 최종 배포판에는 H Memo용 Firebase Web Client 설정을 내장해, 사용자가 별도 설정 없이 **구글 로그인**만으로 서버 백업/복원을 사용할 수 있게 합니다.

## 1) Firebase 프로젝트 준비

현재 기본 배포판은 아래 Firebase 프로젝트를 사용합니다.

- Project ID: `h-memo-60c6b`
- Firestore database: `(default)`, Standard, Native mode, `asia-northeast3 (Seoul)`
- Authentication provider: Google 사용 설정
- Authorized domains: `localhost`, `127.0.0.1`, `tauri.localhost`, `h-memo-60c6b.firebaseapp.com`, `h-memo-60c6b.web.app`

- Firebase 콘솔에서 새 프로젝트 생성 후 웹 앱을 추가합니다.
- Firestore 데이터베이스를 생성합니다. (테스트 모드가 아니라면 보안 규칙을 적용해야 합니다.)
- Authentication → Sign-in method에서 구글 로그인을 사용하도록 설정합니다.
- 프로젝트 설정에서 앱에 사용할 `Web API key`, `Auth domain`, `Project ID`, `App ID`를 확인합니다.

## 2) 환경 변수

기본 배포판은 코드에 포함된 Firebase Web Client 설정을 먼저 사용합니다. 개발/스테이징에서 다른 Firebase 프로젝트를 쓰려면 `.env`, `.env.local`, mode별 env 파일 또는 CI에서 아래 값을 제공해 기본값을 덮어쓸 수 있습니다.

- `VITE_FIREBASE_API_KEY` (필수)
- `VITE_FIREBASE_AUTH_DOMAIN` (필수)
- `VITE_FIREBASE_PROJECT_ID` (필수)
- `VITE_FIREBASE_APP_ID` (필수)
- `VITE_FIREBASE_STORAGE_BUCKET` (선택)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (선택)
- `VITE_FIREBASE_MEASUREMENT_ID` (선택)
- `VITE_GOOGLE_OAUTH_CLIENT_ID` (Windows/macOS/Linux 데스크톱 시스템 브라우저 로그인용, 데스크톱 운영 빌드 필수)
- `GOOGLE_OAUTH_CLIENT_SECRET` (Desktop OAuth 토큰 교환용, GitHub Actions secret으로만 주입)

예시 파일: [`.env.example`](../.env.example)

로컬에서는 다음으로 빠르게 상태를 확인할 수 있습니다.

```bash
npm run check:firebase-env
```

- mode별 파일까지 확인하려면 `node scripts/check-firebase-env.mjs --mode production`처럼 실행합니다.
- 내장 기본값과 환경 변수 적용 후 필수 항목이 누락되면 종료 코드가 1로 실패합니다.
- 누락된 항목 이름만 출력되며 비밀 값은 출력되지 않습니다.

CI에서는 필요 시 GitHub Actions `secrets` 또는 `vars`에 같은 이름의 변수를 등록하고, 윈도우 빌드 job에서 환경변수로 주입하고 있습니다.

설치된 앱이나 웹 미리보기에서 내장/빌드 시점 Firebase 설정이 모두 비어 있는 경우에만 앱 메뉴의 **구글 로그인 설정**이 나타납니다. 이 입력 폼은 개발·진단용이며, 운영 배포판에서는 소유자 Firebase 프로젝트가 고정되도록 숨겨집니다.

## 3) 구글 로그인 설정

1. Firebase 콘솔 → **Authentication** → **Sign-in method**에서 **Google** 제공자 활성화
2. **Settings → Authorized domains**에는 scheme/port가 없는 host 또는 domain만 등록합니다.
   - 로컬 개발: `localhost`, `127.0.0.1`
   - 배포 환경: 앱을 호스팅하는 실제 도메인(예: `example.com`)
   - 데스크톱 OAuth 경로는 Google Cloud의 **Desktop app** client를 사용하므로 여기에는 loopback redirect URI를 추가하지 않습니다.
3. 웹 앱 구성의 API 키 / Auth domain / 프로젝트 ID / 앱 ID가 앱에 내장된 Firebase 설정 또는 `.env`/CI 변수와 일치하는지 확인
4. 앱은 기본적으로 구글 로그인 후 여러 메모 전체의 서버 백업/복원을 동작시킵니다.
5. 데스크톱 Tauri 런타임에서는 시스템 기본 브라우저를 열고 Google **Desktop app** OAuth client의 PKCE + loopback 흐름으로 ID 토큰을 받은 뒤 Firebase credential로 로그인합니다.
6. Google Cloud Console → APIs & Services → Credentials에서 **Desktop app** 유형의 OAuth client를 만들고 client ID를 `VITE_GOOGLE_OAUTH_CLIENT_ID`, client secret을 `GOOGLE_OAUTH_CLIENT_SECRET`으로 주입합니다.
7. `VITE_GOOGLE_OAUTH_CLIENT_ID`가 빠진 Windows 데스크톱 빌드는 Google 로그인 버튼을 비활성화하고 설정 필요 메시지를 표시합니다. `GOOGLE_OAUTH_CLIENT_SECRET`은 GitHub Actions secret으로 저장하고, 프론트엔드 `VITE_` 변수로 만들지 않습니다. 웹 OAuth client의 redirect URI는 loopback 랜덤 포트를 허용하지 않으므로 데스크톱 로그인 대체 경로로 사용하지 않습니다.

## 4) Firestore 경로 및 규칙

백업 문서는 현재 코드에서 아래 경로를 사용합니다.

- `users/{uid}/backupSnapshots/{snapshotId}`
- `users/{uid}/serverMemoDeletes/{memoId}`

`uid` 단위로 사용자를 격리해야 합니다.

저장 규칙은 저장소 루트의 `firestore.rules`에 정리되어 있고, Firebase CLI는 `firebase.json`의 `firestore.rules` 매핑을 사용합니다.

현재 앱은 백업 스냅샷을 새 문서로 추가하고, `서버 메모 관리`에서 특정 메모를 삭제할 때는 기존 스냅샷의 `memos` 배열을 줄인 뒤 `serverMemoDeletes`에 삭제 표시를 남깁니다. 이 삭제 표시가 있어야 예전 백업 스냅샷에 남은 메모가 `서버 복원`으로 다시 나타나지 않습니다. 스냅샷 문서 자체 삭제는 허용하지 않습니다.

### 규칙 적용

```bash
npx firebase-tools deploy --only firestore:rules --project h-memo-60c6b
```

## 5) 백업/복원 확인

Windows 스모크 테스트 체크리스트에서 다음 항목을 확인합니다.

- Firebase 설정이 정상인지 확인: 앱 메뉴의 계정 영역에서 `구글 로그인` 버튼이 활성화되는지 확인
- 앱 실행 후 구글 로그인 성공 표시와 `서버 백업` / `서버 복원` 버튼 활성화 확인
- 여러 메모를 만든 뒤 “서버 백업” 수행 후 성공 메시지(`백업 완료:`) 노출 확인
- 메모를 수정/추가/삭제 후 “서버 복원” 수행 시 최신 백업의 여러 메모가 반영되는지 확인
- 실패 시 화면 status 영역의 오류 메시지와 콘솔 로그 캡처

관련 체크리스트 문서: [`docs/windows-smoke-test.md`](./windows-smoke-test.md)

## 6) 제한 사항

- 이 레포지토리에는 Firebase Web Client 설정이 포함됩니다. 이 값은 브라우저/데스크톱 클라이언트에 공개되는 구성값이며, 보안은 Authentication과 Firestore rules로 강제합니다.
- 서비스 계정 키, 관리자 SDK 비밀, 장기 토큰은 저장소와 앱 번들에 포함하지 않습니다.
- OAuth 동작은 실제 Windows Tauri 런타임에서 최종 확인해야 합니다. 데스크톱 로그인은 `VITE_GOOGLE_OAUTH_CLIENT_ID`와 `GOOGLE_OAUTH_CLIENT_SECRET`이 포함된 시스템 브라우저 OAuth 경로를 사용합니다.
