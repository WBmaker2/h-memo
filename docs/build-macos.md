# macOS 내부 테스트 빌드 가이드 (Tauri)

본 문서는 Apple 유료 개발자 계정 없이 H Memo macOS 내부 테스트 앱을 만드는 절차입니다. 이 경로는 정식 배포가 아니라 개발자/내부 검증용입니다.

## 1) 빌드 전제 조건

- macOS 환경
- Node.js + npm
- Rust/Cargo
- Xcode Command Line Tools

Xcode Command Line Tools가 없으면 다음으로 설치합니다.

```bash
xcode-select --install
```

## 2) 준비

```bash
npm ci
npm run check:versions
```

Google 로그인과 서버 백업까지 검증하려면 Windows 빌드와 동일하게 H Memo용 Firebase Web Client 설정, `VITE_GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`이 빌드 환경에 포함되어야 합니다. macOS 데스크톱 로그인도 시스템 기본 브라우저와 Desktop OAuth client의 로컬 loopback 흐름을 사용합니다.

## 3) macOS 내부 테스트 패키지 빌드

```bash
npm run tauri:build:macos
```

이 명령은 `apps/desktop`의 Tauri 앱을 macOS용 `.app`으로 빌드한 뒤, 내부 테스트용 단순 DMG를 `hdiutil`로 생성합니다. Tauri 기본 DMG 꾸미기 단계는 Finder/AppleScript 권한에 민감하므로 내부 테스트 빌드에서는 사용하지 않습니다.

생성 위치:

- `apps/desktop/src-tauri/target/release/bundle/macos/*.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/*_internal.dmg`

현재 macOS 설정은 내부 테스트를 위해 ad-hoc 서명(`signingIdentity: "-"`)을 사용합니다. Apple Developer ID 서명과 notarization은 적용하지 않습니다.

## 4) 실행 시 보안 경고

Apple 유료 개발자 계정으로 서명/공증하지 않은 앱은 macOS에서 보안 경고가 나타날 수 있습니다. 내부 테스트에서는 다음 방식으로 열 수 있습니다.

1. Finder에서 `.app` 또는 설치한 H Memo 앱을 찾습니다.
2. 앱을 Control-클릭 또는 오른쪽 클릭합니다.
3. **열기**를 선택합니다.
4. macOS가 다시 확인하면 **열기**를 선택합니다.

또는 시스템 설정 → 개인정보 보호 및 보안에서 차단된 앱의 **그래도 열기**를 선택할 수 있습니다.

이 방식은 내부 테스트용입니다. 일반 사용자에게 자연스럽게 배포하려면 Apple Developer Program, Developer ID Application 인증서, notarization, DMG 서명/공증 흐름을 별도 작업으로 추가해야 합니다.

## 5) 로컬 확인 체크리스트

- 앱이 Finder에서 정상 실행되는지
- 메뉴바/트레이 아이콘이 표시되는지
- `메모 모두 열기`, `새 메모`, `종료` 동작이 정상인지
- 여러 메모 창 생성, 이동, 크기 조절, 닫기 후 다시 열기가 가능한지
- 앱 재실행 후 마지막 메모 내용과 창 위치/크기가 유지되는지
- TXT 내보내기와 JSON 백업/복원이 동작하는지
- Google 로그인 후 서버 백업/복원 버튼이 활성화되는지
- 서버 메모 관리에서 복원/삭제가 Windows와 같은 의미로 동작하는지
- 시작프로그램 등록 체크 상태가 여러 메모창에서 동기화되는지

## 6) GitHub Actions

`.github/workflows/macos-tauri.yml`은 PR, `main` push, 태그 push, 수동 실행에서 macOS 내부 테스트 아티팩트를 생성합니다.

업로드되는 아티팩트:

- `h-memo-macos-app`
- `h-memo-macos-dmg`

이 워크플로는 GitHub Release에 macOS 파일을 올리지 않습니다. 정식 macOS 배포 전에 서명/공증 전략과 사용자용 DMG 디자인을 먼저 확정해야 합니다.
