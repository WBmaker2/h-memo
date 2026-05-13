# Firebase / Google 로그인 설정 가이드

이 앱은 Firebase Web Client 설정을 이용해 Google 로그인을 기반으로 백업 기능을 제공합니다.

## 1) 환경 변수

`.env` 또는 CI에서 아래 값을 제공합니다.

- `VITE_FIREBASE_API_KEY` (필수)
- `VITE_FIREBASE_AUTH_DOMAIN` (필수)
- `VITE_FIREBASE_PROJECT_ID` (필수)
- `VITE_FIREBASE_APP_ID` (필수)
- `VITE_FIREBASE_STORAGE_BUCKET` (선택)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (선택)
- `VITE_FIREBASE_MEASUREMENT_ID` (선택)

예시 파일: [`.env.example`](../.env.example)

## 2) Google 로그인 설정

1. Firebase 콘솔 → **Authentication** → **Sign-in method**에서 **Google** 제공자 활성화
2. 지원 이메일/프로젝트 도메인 허용 목록(Authorized domains) 확인
3. 웹 앱 설정에서 앱 ID/도메인/API 키가 `.env`와 일치하는지 확인
4. 앱은 기본적으로 Google 로그인 상태에서 백업/복원 동작을 수행합니다.

## 3) Firestore 경로

백업 문서는 현재 코드에서 아래 경로를 사용합니다.

- `users/{uid}/backupSnapshots/{snapshotId}`

`uid` 단위로 사용자를 격리해야 합니다.

## 4) 권장 보안 규칙(최소 정책)

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

실서비스에서는 같은 UID 정책을 `memos` 경로 등 다른 사용자 데이터에도 확장하는 것을 권장합니다.
