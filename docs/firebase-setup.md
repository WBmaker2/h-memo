# Firebase / Google 로그인 설정 가이드

이 앱은 Firebase Web Client 설정을 이용해 Google 로그인을 기반으로 백업 기능을 제공합니다.

## 1) Firebase 프로젝트 준비

- Firebase 콘솔에서 새 프로젝트 생성 후 웹 앱을 추가합니다.
- Firestore 데이터베이스를 생성합니다. (테스트 모드가 아니라면 보안 규칙을 적용해야 합니다.)
- Authentication → Sign-in method에서 Google 로그인을 사용하도록 설정합니다.
- 프로젝트 설정에서 앱에 사용할 `Web API key`, `Project ID`, `App ID`를 확인합니다.

## 2) 환경 변수

`.env` 또는 CI에서 아래 값을 제공합니다. 이 저장소에는 실제 서비스 값이 포함되어 있지 않습니다.

- `VITE_FIREBASE_API_KEY` (필수)
- `VITE_FIREBASE_AUTH_DOMAIN` (필수)
- `VITE_FIREBASE_PROJECT_ID` (필수)
- `VITE_FIREBASE_APP_ID` (필수)
- `VITE_FIREBASE_STORAGE_BUCKET` (선택)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (선택)
- `VITE_FIREBASE_MEASUREMENT_ID` (선택)

예시 파일: [`.env.example`](../.env.example)

로컬에서는 다음으로 빠르게 상태를 확인할 수 있습니다.

```bash
node scripts/check-firebase-env.mjs
```

- 필수 항목이 누락되면 종료 코드가 1로 실패합니다.
- 누락된 항목 이름만 출력되며 비밀 값은 출력되지 않습니다.

CI에서는 필요 시 GitHub Actions `secrets` 또는 `vars`에 같은 이름의 변수를 등록하고, 윈도우 빌드 job에서 환경변수로 주입하고 있습니다.

## 3) Google 로그인 설정

1. Firebase 콘솔 → **Authentication** → **Sign-in method**에서 **Google** 제공자 활성화
2. **Settings → Authorized domains**에 아래 도메인을 등록합니다.
   - 로컬 개발: `localhost`, `localhost:1420`, `127.0.0.1`(또는 Vite가 사용하는 로컬 포트)
   - Tauri 런타임: 기본 웹뷰 출처 또는 `tauri://localhost` 계열(실제 런타임 출력에 따라 다름)
   - 배포 도메인: 앱을 호스팅하는 실제 도메인
3. 웹 앱 구성의 API 키 / 프로젝트 ID / 앱 ID가 `.env`(또는 CI 변수)와 일치하는지 확인
4. 앱은 기본적으로 Google 로그인 후 서버 백업/복원을 동작시킵니다.

## 4) Firestore 경로 및 규칙

백업 문서는 현재 코드에서 아래 경로를 사용합니다.

- `users/{uid}/backupSnapshots/{snapshotId}`

`uid` 단위로 사용자를 격리해야 합니다.

저장 규칙은 저장소 루트의 `firestore.rules`에 정리되어 있고, Firebase CLI는 `firebase.json`의 `firestore.rules` 매핑을 사용합니다.

### 권장 보안 규칙(최소 정책)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/backupSnapshots/{snapshotId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

실서비스에서는 같은 UID 정책을 `memos` 등 다른 사용자 데이터 경로에도 확장하고, 추가 커스텀 인덱스/검증 로직을 적용하는 것을 권장합니다.

### 규칙 적용

```bash
firebase deploy --only firestore:rules
```

## 5) 백업/복원 확인

Windows 스모크 테스트 체크리스트에서 다음 항목을 확인합니다.

- Firebase 환경이 정상인지 확인: `node scripts/check-firebase-env.mjs`
- 앱 실행 후 Google 로그인 성공
- “서버 백업” 수행 후 성공 메시지(`백업 완료:`) 노출 확인
- 메모를 수정/추가 후 “서버 복원” 수행 시 최신 백업 내용 반영 확인
- 실패 시 화면 status 영역의 오류 메시지와 콘솔 로그 캡처

관련 체크리스트 문서: [`docs/windows-smoke-test.md`](./windows-smoke-test.md)

## 6) 제한 사항

- 이 레포지토리는 Firebase 운영 프로젝트 값(비밀 포함)을 포함하지 않습니다.
- 실제 운영 프로젝트 연결, 도메인 승인, OAuth 동작은 사용자 환경의 Firebase/Google 설정이 필요합니다.
