# H Memo Google OAuth client secret 회귀 수정 계획

## 문제

- 사용자가 Google 계정 비밀번호 변경 후 다시 로그인하자 토큰 교환 단계에서
  `client_secret is missing` 오류가 발생했습니다.
- GitHub Actions에는 `GOOGLE_OAUTH_CLIENT_SECRET`이 등록되어 있지만 현재
  Windows/macOS 릴리스 워크플로가 값을 빌드에 전달하지 않습니다.
- Rust 토큰 교환 코드도 `client_secret` 파라미터를 제거한 상태입니다.

## 원인

- 공개 저장소 보안 강화 과정에서 Desktop OAuth PKCE 흐름은 client secret이
  필요하지 않다는 가정으로 기존 지원을 제거했습니다.
- 현재 Google OAuth 클라이언트는 토큰 엔드포인트에서 client secret을
  요구하므로 계정 승인 후 코드 교환이 실패합니다.

## 구현

1. Actions secret을 Windows/macOS 네이티브 빌드에만 전달합니다.
2. 릴리스 빌드는 client ID와 client secret을 모두 사전 검사합니다.
3. Rust 코드가 빌드 시 주입된 값을 읽어 토큰 교환 폼에 포함하도록 복원합니다.
4. 빈 secret은 요청에 넣지 않고 명확한 설정 오류를 반환합니다.
5. 공개 저장소에는 실제 값을 기록하지 않고, 설치형 앱에서는 이 값이
   추출 가능하다는 보안 한계를 문서화합니다.
6. 데스크톱 앱과 웹 랜딩 페이지의 업데이트 내역을 함께 갱신합니다.

## 검증

- Rust 단위 테스트로 client secret 포함·공백 제거·누락 동작을 검증합니다.
- Workflow 테스트로 Windows/macOS 주입과 릴리스 사전 검사를 검증합니다.
- 공개 저장소 보안 테스트는 값의 하드코딩과 `VITE_` 접두사 사용을 금지합니다.
- 전체 JavaScript 테스트, 타입 검사, Rust 테스트, 프로덕션 빌드를 실행합니다.
- `main` CI 성공 후 자동 patch 버전, Windows Release, macOS 아티팩트,
  GitHub Pages 배포를 확인합니다.
