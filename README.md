# H Memo

H Memo는 Tauri 2 + React + TypeScript로 만든 Windows 데스크톱 1차 MVP입니다.  
공통 메모 도메인과 UI는 워크스페이스 패키지에 두고, `apps/desktop`에서 플랫폼 실행 로직만 처리합니다.

## 모노레포 구조

- `apps/desktop`: Tauri 데스크톱 앱(PWA/UI 진입점 포함)
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
npm run tauri:dev            # Tauri 개발 실행
npm run tauri:build          # Tauri Windows/MSI/NSIS 빌드 시도
```

## 로컬 개발 가이드

```bash
cp .env.example .env
npm ci
npm run dev
```

### Firebase 환경 변수

필수/선택 변수는 [`docs/firebase-setup.md`](./docs/firebase-setup.md) 또는 `.env.example`를 참고하세요.

## 테스트/타입체크/빌드

```bash
npm test
npm run typecheck
npm run build -w apps/desktop
```

### Tauri 빌드

Windows 패키징은 Rust/Cargo가 필요합니다.  
로컬에서 현재 환경에 cargo가 없으면 `npm run tauri:build -w apps/desktop`이 실패할 수 있으므로, GitHub Actions(Windows)에서 검증하는 것을 권장합니다.

```bash
# Rust/Cargo 설치 후 실행
npm run tauri:build -w apps/desktop
```

## 패키징/배포 문서

- [`docs/build-windows.md`](./docs/build-windows.md)
- [`docs/firebase-setup.md`](./docs/firebase-setup.md)
- GitHub Actions
  - [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
  - [`.github/workflows/windows-tauri.yml`](.github/workflows/windows-tauri.yml)
  - [`docs/release.md`](./docs/release.md)
