# H Memo 무료 Tauri updater 기반 Windows 자동 업데이트 계획

- 작성일: 2026-08-30
- 상태: 구현 및 v1.0.8 릴리스 완료
- 결정: 유료 Windows Authenticode 인증서 서명 없이 Tauri updater의 무료 암호화 서명만 사용

## 1. 목표와 확정 범위

H Memo Windows 데스크톱 앱이 시작될 때 새 버전을 확인하고, 새 버전이 있으면 다음과 같은 사용자 선택 대화상자를 표시합니다.

> 프로그램을 v1.0.7(최신 버전)으로 업그레이드하시겠습니까?

사용자가 동의하면 새 설치 파일을 다운로드하고 설치를 시작합니다. 기존 앱을 먼저 삭제하도록 요구하지 않습니다.

이번 구현의 범위는 다음과 같습니다.

- Tauri v2 updater 플러그인 및 JavaScript API 연결
- Tauri updater용 무료 키 쌍 서명
  - 서명용 개인 키는 GitHub Actions Secret에만 보관합니다.
  - 공개 키는 release 빌드에 주입하며 저장소에 개인 키를 기록하지 않습니다.
- GitHub Release의 정적 `latest.json` manifest 생성 및 게시
- Windows x86_64용 MSI를 updater의 표준 설치 payload로 사용
- 앱 시작 시 서버 최신 메모리 복원 확인과 충돌하지 않는 업데이트 확인
- 업데이트 확인, 설치 진행률, 실패, 재시도, 예/아니요와 재안내 기간 선택 사용자 경험
- 웹 랜딩 페이지와 데스크톱 앱의 `업데이트 내역`에 같은 변경 사항 기록
- 유료 Windows Authenticode/Azure Artifact Signing 없이 동작하는 Windows release workflow

## 2. 범위 밖의 항목

- Windows Authenticode 인증서 발급, Azure Artifact Signing 리소스, OIDC 권한 추가
- 서명이 전혀 없는 임의 실행 파일 교체 방식
- Microsoft Store/MSIX 배포 전환
- macOS 자동 업데이트
- 웹 브라우저 버전의 자동 업데이트
- MSI와 NSIS를 설치 방식별로 자동 판별하는 migration 로직
- Windows 릴리스의 실제 운영 승인·수동 설치 확인

## 3. 구현 결정

### 3.1 배포와 검증 구조

```text
Windows Tauri release build
  ├─ MSI + MSI.sig       ─┐
  ├─ NSIS EXE + EXE.sig   ├─ GitHub Release assets
  └─ (무료 Tauri 서명)   ┘
              │
              └─ latest.json
                   └─ windows-x86_64.url = MSI
                   └─ windows-x86_64.signature = MSI.sig 내용

H Memo 시작
  └─ main 창 + 초기 복원 잠금 해제
       └─ updater.check()
            ├─ 새 버전 없음: 조용히 종료
            ├─ 새 버전 있음: 업데이트 대화상자
            └─ 네트워크/manifest 오류: 시작을 막지 않고 다음 시작 때 재시도
```

- 기존 프로젝트의 Windows 공개 다운로드 정책이 MSI 우선이므로 updater도 MSI를 기준으로 합니다.
- NSIS와 각 `.sig` 파일도 release에 보관하여 수동 설치 및 향후 확장에 사용할 수 있게 합니다.
- updater 서명은 설치 파일의 무결성과 출처를 확인하지만, Windows Authenticode 서명이 아니므로 SmartScreen 경고가 남을 수 있습니다.
- `latest.json`은 GitHub Release에 게시되는 정적 파일입니다. 저장소의 웹 다운로드용 `download-manifest.json`과 혼동하지 않습니다.

### 3.2 키 취급

- `TAURI_SIGNING_PRIVATE_KEY`: GitHub Actions Secret. 로그, 소스, artifact에 노출하지 않습니다.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 선택 사항인 개인 키 비밀번호 Secret.
- `TAURI_UPDATER_PUBLIC_KEY`: GitHub Actions Variable 또는 안전한 공개 설정값. release 컴파일 때 Rust updater builder에 주입합니다.
- release workflow는 두 값이 없으면 서명되지 않은 release를 만들지 않고 즉시 실패합니다.
- 로컬 개발 및 PR 검증 빌드는 updater artifact 생성을 끄고, 개인 키를 요구하지 않습니다.

### 3.3 시작 시점과 상태

업데이트 확인은 다음 조건을 모두 만족한 뒤 한 번만 시작합니다.

- Tauri main 창입니다.
- Firebase 인증 상태가 정리되었습니다.
- 메모리 로딩이 끝났습니다.
- startup server restore 잠금이 해제되었습니다.
- 서버 복원 대화상자가 열려 있지 않습니다.

상태 전이는 다음과 같이 고정합니다.

```text
idle → checking → idle                         (업데이트 없음)
                   └→ available → dismissed   (아니요 또는 재안내 기간 저장)
                                └→ installing → 앱 재시작/설치
                                └→ error → installing (재시도)
```

`check()` 실패는 오프라인 사용을 막지 않도록 비차단 처리합니다. 다운로드 또는 설치 실패는 사용자에게 원인과 재시도 선택을 제공합니다. 원격 release notes는 신뢰할 수 없는 일반 텍스트로 취급하고 HTML로 해석하지 않습니다.

## 4. 파일별 작업 계획

### Tauri와 의존성

- `apps/desktop/package.json`
  - `@tauri-apps/plugin-updater` 추가
  - Windows release용 updater build 명령과 manifest 생성 명령을 명확히 유지합니다.
- `package-lock.json`
  - workspace 의존성 잠금 갱신
- `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Cargo.lock`
  - `tauri-plugin-updater` 추가 및 잠금 갱신
- `apps/desktop/src-tauri/tauri.conf.json`
  - GitHub `latest.json` endpoint와 Windows passive install mode 추가
  - 일반 로컬/PR 빌드에서는 `createUpdaterArtifacts`를 끄고, release workflow만 config override로 켭니다.
- `apps/desktop/src-tauri/capabilities/default.json`
  - updater 플러그인의 최소 권한만 추가합니다.
- `apps/desktop/src-tauri/src/lib.rs`
  - updater plugin 등록
  - release 빌드에서 `TAURI_UPDATER_PUBLIC_KEY`를 compile-time으로 주입하고 누락 시 fail-closed 처리

### 앱 UI와 상태 관리

- `apps/desktop/src/features/updater/useDesktopUpdater.ts` 신규
  - Tauri `check`, `downloadAndInstall`, `Update.close()` lifecycle 관리
  - 중복 check 방지, blocked 조건, 진행률, 실패 재시도 상태 구현
- `apps/desktop/src/features/updater/DesktopUpdatePrompt.tsx` 신규
  - main 창과 startup 상태를 연결하고 shared dialog에 안전한 표시 데이터만 전달
- `packages/memo-ui/src/AppUpdateDialog.tsx` 신규
  - 접근 가능한 modal, 키보드 Enter/Escape, 포커스, 설치 진행률, 오류/재시도 UI 구현
- `packages/memo-ui/src/index.ts`
  - 새 공용 dialog export
- `apps/desktop/src/App.tsx`
  - startup restore 이후 위치에 desktop updater prompt를 얇게 연결
- `apps/desktop/src/styles.css`
  - 업데이트 modal 및 진행 상태 스타일 추가
- `packages/memo-ui/src/MemoWorkspace.tsx`
  - 기존 `업데이트 내역`에 updater 기능 기록 추가
- `apps/web/src/landing/LandingPage.tsx`
  - 데스크톱과 동일한 release history 항목 추가

### Release automation과 문서

- `scripts/create-updater-manifest.mjs` 신규
  - MSI와 `.msi.sig`를 읽어 `latest.json` 생성
  - version, HTTPS GitHub Release URL, signature 내용, Windows target을 검증
- `scripts/lib/create-updater-manifest.js` 신규
  - manifest 생성/검증 순수 로직 분리
- `scripts/create-updater-manifest.test.ts` 신규
  - 정상 manifest, 누락 signature, 잘못된 version/repository/asset 오류 테스트
- `.github/workflows/windows-tauri.yml`
  - Azure login, OIDC, paid signing, signing environment 의존성 제거
  - release build에만 Tauri updater private key와 public key 주입
  - MSI/NSIS와 `.sig` artifact 수집
  - `latest.json` 생성 후 GitHub Release에 함께 게시
- `scripts/windows-workflow.test.ts`
  - 무료 Tauri 서명 경로, key guard, `.sig`, manifest 게시를 정적 검증
  - Azure/Authenticode가 활성 경로가 아님을 검증
- `docs/build-windows.md`, `docs/release.md`
  - Secret/Variable 준비, release 절차, SmartScreen 한계, bootstrap 및 복구 절차 문서화

### 테스트

- `packages/memo-ui/src/AppUpdateDialog.test.tsx` 신규
  - 새 버전 문구, 기본 포커스, Enter/Escape, 진행률, 오류 재시도, 원격 텍스트 escaping 검증
- `apps/desktop/src/features/updater/useDesktopUpdater.test.tsx` 신규
  - no-update/update/block/decline/install-progress/install-error/retry/cleanup 검증
- 기존 앱 테스트와 `scripts/windows-workflow.test.ts` 회귀 검증

## 5. TDD와 검증 순서

1. 위 계획 문서를 저장합니다. (현재 단계)
2. updater state와 manifest 순수 로직 테스트를 먼저 작성합니다.
3. Tauri 의존성/config/capability/Rust plugin을 연결합니다.
4. hook과 dialog를 구현하고 상태 테스트를 통과시킵니다.
5. App, 업데이트 내역, CSS를 연결합니다.
6. workflow와 manifest 생성기를 구현하고 정적 workflow 테스트를 통과시킵니다.
7. 다음 검증을 실행합니다.

```bash
npm run check:versions
npm test
npm run typecheck
npm run build
npm run tauri:build:windows
```

마지막 Windows 명령은 Windows runner에서 확인합니다. 로컬 macOS에서는 Tauri Windows bundle을 성공했다고 추정하지 않습니다. release tag 검증은 필요한 Secret/Variable이 구성된 별도 GitHub Actions 실행에서 수행합니다.

## 6. 수용 기준

- 새 버전이 있을 때 main 창에 한국어 업데이트 확인 dialog가 표시됩니다.
- startup server restore 중에는 업데이트 dialog가 겹치지 않습니다.
- `아니요`를 선택하면 현재 실행을 계속할 수 있고, 같은 실행에서 반복 표시되지 않습니다.
- `1주일 뒤에 다시 안내` 또는 `1달 뒤에 다시 안내`를 선택하면 해당 기간 동안 원격 업데이트 확인과 대화상자 표시를 건너뜁니다.
- `예`를 선택하면 Tauri가 서명 검증 후 MSI 설치를 시작합니다.
- 설치 파일 또는 signature가 바뀌면 updater가 설치를 거부합니다.
- 네트워크가 없거나 manifest가 없을 때 앱 시작과 기존 메모리 기능은 계속 사용할 수 있습니다.
- release workflow에는 Authenticode/Azure/OIDC가 필요하지 않습니다.
- release에는 MSI, MSI signature, NSIS, NSIS signature, `latest.json`이 모두 포함됩니다.
- `latest.json`의 Windows URL과 signature가 실제 release asset과 일치합니다.
- 앱과 웹의 `업데이트 내역`에 같은 기능 기록이 보입니다.
- 개인 키가 저장소, 로그, 빌드 artifact에 노출되지 않습니다.

## 7. 운영 전제와 위험

- 첫 updater-enabled release 전의 기존 설치본은 manifest가 없는 이전 release를 보므로 자동 업데이트가 되지 않을 수 있습니다. 첫 배포는 기존 공개 다운로드 경로로 한 번 설치해야 합니다.
- MSI 설치본을 updater 기준으로 삼으므로 기존 NSIS 설치본은 첫 updater-enabled MSI 설치 시 설치 방식이 달라질 수 있습니다. 이번 범위에서는 자동 migration을 약속하지 않습니다.
- 무료 Tauri updater 서명은 Windows가 표시하는 개발자/게시자 신뢰 경고를 없애지 않습니다. 사용자 안내와 수동 설치 fallback을 문서에 남깁니다.
- 개인 키를 분실하면 이후 update artifact를 같은 신뢰 체계로 서명할 수 없으므로 Secret 백업 정책이 필요합니다.
- 사용자 승인 후 Tauri 개인 키는 GitHub Secret에, 공개 키는 GitHub Variable에 등록했으며, v1.0.8 release workflow의 CLI config override에 `plugins.updater.pubkey` 필드가 빠져 첫 Windows 빌드가 실패했습니다.

## 8. 작업 로그

- 2026-08-30: 사용자로부터 “유료 Windows 인증서 서명 없이, Tauri 무료 업데이트 서명만 사용” 결정과 구현 착수를 승인받음.
- 2026-08-30: 계획 문서 작성 완료 후 구현 시작.
- 2026-08-30: Tauri updater 상태/UI, 정적 manifest 생성기, Windows release workflow, 문서와 앱·웹 업데이트 내역을 구현함.
- 2026-08-30: 전체 Vitest는 한 차례 76개 파일 통과·1개 skip, 552개 테스트 통과·11개 skip으로 완료함. 반복 집계에서는 기존 `apps/web/src/WebApp.test.tsx` 백업 타이밍 테스트가 간헐적으로 1건 실패했지만 해당 파일 단독 재실행은 42/42 통과함. TypeScript, Vite, Rust check/test, 버전·JSON·YAML·diff 검증도 완료함.
- 2026-08-30: 사용자 승인 후 Tauri 개인 키를 GitHub Secret, 공개 키를 GitHub Variable로 등록함. 첫 v1.0.8 Windows release workflow는 Tauri bundler 설정에서 `plugins.updater.pubkey`가 빠져 실패했으며, release 전용 config override에 공개 키를 주입하는 hotfix를 추가하고 정적 workflow 테스트 6건과 버전 검사를 통과시킴.
- 2026-08-30: 기존 v1.0.8 태그를 유지하기 위해 release가 없는 기존 태그를 명시적으로 재빌드하는 경로를 추가함. 조상 태그·허용된 release-tooling 변경 파일·`rebuild_existing_tag=true` 입력을 모두 확인하며, `fix(release):` hotfix는 자동 patch bump에서 제외함.
- 2026-08-30: GitHub Release가 파일명의 공백을 점으로 정규화할 수 있는 것을 확인함. 설치 파일을 먼저 게시한 뒤 실제 MSI asset명을 조회해 `latest.json`을 생성하도록 workflow와 manifest 생성기를 보완함.
- 2026-08-30: Windows release workflow 33315582526이 signed MSI/NSIS와 각 signature, `latest.json` 게시에 성공함. manifest의 MSI URL을 실제 `H.Memo_1.0.8_x64_en-US.msi` asset으로 보정한 뒤 URL HTTP 200과 signature 길이 416을 확인했으며, GitHub Pages v1.0.8 배포와 main CI도 성공함.

## 9. 후속 요청: 업데이트 선택 및 재안내 기간

사용자 후속 요청에 따라 새 버전 대화상자의 선택 동작을 다음과 같이 확장합니다.

- 기존 `나중에` 버튼을 명확한 `아니요` 버튼으로 변경하고, 동의 버튼은 `예`로 표시합니다.
- `1주일 뒤에 다시 안내`, `1달 뒤에 다시 안내` 두 체크 상자를 제공합니다.
- 체크 상자는 한 번에 하나만 선택할 수 있으며, `아니요`를 누를 때 선택한 기간을 데스크톱 WebView의 localStorage에 저장합니다.
- 저장된 기간 동안에는 updater의 원격 확인 자체를 건너뛰고, 만료되면 다음 시작에서 다시 확인합니다.
- 기간을 선택하지 않고 `아니요`를 누르면 현재 실행에서만 닫고 다음 시작 때 다시 확인합니다.
- `예`를 누르면 선택한 재안내 기간과 관계없이 즉시 Tauri updater 설치를 시작합니다.
- 버전 변경은 저장소 규칙에 따라 수동 편집하지 않고, 당시 원격 `main`의 `v1.0.7`에서 실제 변경 CI가 성공한 뒤 `npm run version:bump` 자동 릴리스 경로로 `v1.0.8`을 생성합니다.
- v1.0.8 랜딩페이지 업데이트 기록에 예/아니요 및 재안내 선택 기능을 기록합니다.
