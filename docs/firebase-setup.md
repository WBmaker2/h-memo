# Firebase / 구글 로그인 설정 가이드

이 앱은 Firebase Web Client 설정을 이용해 구글 로그인을 기반으로 백업 기능을 제공합니다. 최종 배포판에는 H Memo용 Firebase Web Client 설정을 내장해, 사용자가 별도 설정 없이 **구글 로그인**만으로 서버 백업/복원을 사용할 수 있게 합니다.

## 1) Firebase 프로젝트 준비

현재 기본 배포판은 아래 Firebase 프로젝트를 사용합니다.

- Project ID: `h-memo-60c6b`
- Firestore database: `(default)`, Standard, Native mode, `asia-northeast3 (Seoul)`
- Authentication provider: Google 사용 설정
- Authorized domains: `localhost`, `127.0.0.1`, `tauri.localhost`, `h-memo-60c6b.firebaseapp.com`, `h-memo-60c6b.web.app`, `wbmaker2.github.io`

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

예시 파일: [`.env.example`](../.env.example)

로컬에서는 다음으로 빠르게 상태를 확인할 수 있습니다.

```bash
npm run check:firebase-env
```

- mode별 파일까지 확인하려면 `node scripts/check-firebase-env.mjs --mode production`처럼 실행합니다.
- 내장 기본값과 환경 변수 적용 후 필수 항목이 누락되면 종료 코드가 1로 실패합니다.
- 누락된 항목 이름만 출력되며 비밀 값은 출력되지 않습니다.

CI에서는 필요 시 GitHub Actions `secrets` 또는 `vars`에 `VITE_GOOGLE_OAUTH_CLIENT_ID`를 등록하고, Windows/macOS 데스크톱 빌드 job에서 환경변수로 주입합니다.
`GOOGLE_OAUTH_CLIENT_SECRET`은 Desktop OAuth PKCE 흐름에서 더 이상 사용되지 않으므로, 이번 변경 후 즉시 삭제하거나 회전(재발급 후 교체)할 수 있습니다.

설치된 앱이나 웹 앱에서 내장/빌드 시점 Firebase 설정이 모두 비어 있는 경우에만 앱 메뉴의 **구글 로그인 설정**이 나타납니다. 이 입력 폼은 개발·진단용이며, 운영 배포판에서는 소유자 Firebase 프로젝트가 고정되도록 숨겨집니다.

## 3) 구글 로그인 설정

1. Firebase 콘솔 → **Authentication** → **Sign-in method**에서 **Google** 제공자 활성화
2. **Settings → Authorized domains**에는 scheme/port가 없는 host 또는 domain만 등록합니다.
   - 로컬 개발: `localhost`, `127.0.0.1`
   - 배포 환경: 앱을 호스팅하는 실제 도메인(예: `example.com`)
   - 데스크톱 OAuth 경로는 Google Cloud의 **Desktop app** client를 사용하므로 여기에는 loopback redirect URI를 추가하지 않습니다.
3. 웹 앱 구성의 API 키 / Auth domain / 프로젝트 ID / 앱 ID가 앱에 내장된 Firebase 설정 또는 `.env`/CI 변수와 일치하는지 확인
4. 앱은 기본적으로 구글 로그인 후 여러 메모 전체의 서버 백업/복원을 동작시킵니다.
5. 데스크톱 Tauri 런타임에서는 시스템 기본 브라우저를 열고 Google **Desktop app** OAuth client의 PKCE + loopback 흐름으로 ID 토큰을 받은 뒤 Firebase credential로 로그인합니다.
6. Google Cloud Console → APIs & Services → Credentials에서 **Desktop app** 유형의 OAuth client를 만들고 client ID를 앱 설정에 `VITE_GOOGLE_OAUTH_CLIENT_ID`로 주입합니다.
7. `VITE_GOOGLE_OAUTH_CLIENT_ID`가 빠진 데스크톱 빌드는 Google 로그인 버튼을 비활성화하고 설정 필요 메시지를 표시합니다. 웹 OAuth client의 redirect URI는 loopback 랜덤 포트를 허용하지 않으므로 데스크톱 로그인 대체 경로로 사용하지 않습니다.
   `GOOGLE_OAUTH_CLIENT_SECRET`은 더 이상 데스크톱 OAuth 토큰 교환 파라미터로 사용되지 않습니다.

## 4) 웹앱 배포 도메인 허용

Firebase Console → **Authentication** → **Settings** → **Authorized domains**에서 배포 도메인을 허용합니다.

- GitHub Pages 도메인: `wbmaker2.github.io`
- 앱 URL 예시: `https://wbmaker2.github.io/h-memo/`
- 웹앱은 브라우저 Firebase Auth popup/redirect 흐름을 사용합니다.
- 데스크톱용 `VITE_GOOGLE_OAUTH_CLIENT_ID`은 웹앱 빌드에 필요하지 않습니다.

## 5) Firestore 경로 및 규칙

백업 문서는 아래 v2 경로를 사용합니다.

- 현재 서버 메모: `users/{uid}/memos/{memoId}`
- 스냅샷 메타데이터: `users/{uid}/backupSnapshots/{snapshotId}`
- 불변 스냅샷 메모: `users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}`
- 현재 활성 generation 포인터: `users/{uid}/backupState/current`
- 서버 삭제 표시: `users/{uid}/serverMemoDeletes/{memoId}`

### 이전 초기 구현 (역사적 기록)

초기 Task 3 구현에서 사용한 canonical `generations.{snapshotId}` map과 그 안의 memo body는 역사적 설계 기록일 뿐입니다. 현재 저장 규약에서는 이 map이나 canonical memo body를 작성하지 않습니다.

### 현재 canonical 규약 (기준)

현재 서버 메모 문서는 정확히 `userId`, `memoId`, `active`, `pending`만 보관합니다. `active`와 `pending`은 `null` 또는 정확히 `snapshotId`와 서버 시각 `savedAt`만 가진 참조 map입니다. 실제 memo body는 오직 `backupSnapshots/{snapshotId}/memos/{memoId}`의 불변 문서에만 보관합니다. `backupState/current`은 `activeSnapshotId`, nullable `pendingSnapshotId`, 서버 `activatedAt`을 보관합니다. 앱은 활성 포인터와 일치하는 `active` 또는 `pending` 참조를 찾은 뒤 해당 불변 body를 검증하여 현재 메모를 노출합니다. 스냅샷 메타데이터는 `schemaVersion: 2`, `userId`, 클라이언트 payload의 `createdAt`, `memoCount`, `state`, 서버 시각 `savedAt`을 저장합니다.

백업은 시작 transaction에서 `state: "writing"` 메타데이터와 사용자별 `pendingSnapshotId` lease를 함께 기록합니다. 활성 memo ID가 중복되면 이 단계 이전에 실패하며 어떤 Firestore 문서도 쓰지 않습니다. 새 백업은 이전 pending lease를 교체하되 `activeSnapshotId`는 보존하므로, 교체된 백업은 다음 작업에서 안전하게 중단됩니다. 활성 메모는 최대 200개씩 처리하며, 각 transaction은 자기 `pendingSnapshotId`를 확인한 뒤 그 청크의 모든 canonical 문서를 읽고, 그 최신 참조를 기준으로 canonical `pending` 참조와 불변 snapshot body를 최대 400개 write합니다. 이 읽기는 동시 서버 삭제와 충돌하면 transaction을 재시도하게 합니다. 기존 활성 참조는 보존하고, 이전 실패 시 남은 `pending`은 다음 백업이 덮어써 canonical 문서 크기가 고정됩니다. 최종 activation transaction도 같은 lease를 확인한 뒤에만 메타데이터를 `state: "complete"` 및 서버 `savedAt`으로 전환하고, `activeSnapshotId`를 새 snapshot으로 바꾸며 `pendingSnapshotId`를 `null`로 지웁니다. 따라서 body와 참조가 durable해지기 전에는 새 상태가 읽기 경로에 노출되지 않고, superseded 또는 실패한 백업 뒤에도 이전 활성 상태가 유지됩니다. 정리 작업은 `pending`을 `active`로 옮길 수 있지만 정확성은 그 정리에 의존하지 않습니다. 읽기 경로는 완료된 v2 스냅샷만 사용하며, 기록 표시와 정렬에는 서버 `savedAt`을 사용합니다.

`uid` 단위로 사용자를 격리해야 합니다.

저장 규칙은 저장소 루트의 `firestore.rules`에 정리되어 있고, Firebase CLI는 `firebase.json`의 `firestore.rules` 매핑을 사용합니다.

기존 inline 배열 기반 version-1 스냅샷은 읽기와 복원을 계속 지원하며, 서버 `savedAt`이 없으면 기존 클라이언트 `createdAt`을 기록 시간의 fallback으로 사용합니다. 새 백업은 v2만 작성합니다.

`서버 메모 관리`는 활성 snapshot의 검증된 참조/body만 조회합니다. 서버에서 메모를 삭제하면 transaction이 현재 활성 `snapshotId`를 포함한 tombstone을 기록하고, 그 snapshot과 일치하는 canonical 참조만 제거합니다. 과거 스냅샷 body는 변경하지 않습니다. Tombstone은 메모별로 유지되며, 활성 snapshot이 해당 메모의 유효한 canonical 참조와 body를 실제로 포함할 때만 논리적으로 해제됩니다. 따라서 A에서 X를 삭제한 뒤 B에 X가 없으면 X는 모든 기록에서 계속 숨겨지고, C에 X가 다시 포함되어 활성화된 뒤에만 X가 보입니다. `snapshotId`가 없는 legacy tombstone도 같은 규칙을 따릅니다. 물리적 tombstone 삭제는 선택 사항입니다. 스냅샷 메타데이터와 하위 메모 문서는 삭제할 수 없고, 하위 메모 문서는 생성 후 수정할 수 없습니다.

### 규칙 적용

```bash
npx firebase-tools deploy --only firestore:rules --project h-memo-60c6b
```

## 6) 백업/복원 확인

Windows/macOS 스모크 테스트 체크리스트에서 다음 항목을 확인합니다.

- Firebase 설정이 정상인지 확인: 앱 메뉴의 계정 영역에서 `구글 로그인` 버튼이 활성화되는지 확인
- 앱 실행 후 구글 로그인 성공 표시와 `서버 백업` / `서버 복원` 버튼 활성화 확인
- 여러 메모를 만든 뒤 “서버 백업” 수행 후 성공 메시지(`백업 완료:`) 노출 확인
- 메모를 수정/추가/삭제 후 “서버 복원” 수행 시 최신 백업의 여러 메모가 반영되는지 확인
- 실패 시 화면 status 영역의 오류 메시지와 콘솔 로그 캡처

이 저장소의 unit test는 Firebase emulator를 설정하지 않습니다. 대신 injectable Firestore driver로 실제 gateway의 chunk, activation, transaction, timestamp 정규화, wrapper 검증을 실행합니다. Firestore rules는 문자열 기반 policy regression test로 확인하므로, emulator 수준의 rules 실행 검증은 배포 전 별도 작업입니다.

관련 체크리스트 문서: [`docs/windows-smoke-test.md`](./windows-smoke-test.md)

## 7) 제한 사항

- 이 레포지토리에는 Firebase Web Client 설정이 포함됩니다. 이 값은 브라우저/데스크톱 클라이언트에 공개되는 구성값이며, 보안은 Authentication과 Firestore rules로 강제합니다.
- 서비스 계정 키, 관리자 SDK 비밀, 장기 토큰은 저장소와 앱 번들에 포함하지 않습니다.
- OAuth 동작은 실제 Windows/macOS Tauri 런타임에서 최종 확인해야 합니다. 데스크톱 로그인은 `VITE_GOOGLE_OAUTH_CLIENT_ID`가 포함된 시스템 브라우저 OAuth 경로를 사용합니다.
