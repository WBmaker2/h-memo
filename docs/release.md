# GitHub Release 자동화 가이드

`windows-tauri.yml`은 PR/일반 검증에서는 개인 키 없이 Windows 설치 파일을 만들고, release tag 또는 `release_tag`가 지정된 수동 실행에서는 Tauri updater용 무료 암호화 서명만 사용합니다. Windows Authenticode 인증서, Azure Artifact Signing, Azure OIDC는 현재 release 경로에 필요하지 않습니다.

`macos-tauri.yml` 워크플로는 Apple 유료 개발자 계정 없이 내부 테스트용 `.app`/`.dmg` artifact만 생성합니다. macOS artifact는 현재 GitHub Release에 자동 업로드하지 않습니다.

## 1) 자동 버전과 태그 릴리스

`main`에 실제 변경이 반영되고 CI가 성공하면 `Auto Version and Tag` 워크플로가 patch 버전을 1 올리고 `vX.Y.Z` 태그를 생성합니다. 이 워크플로는 태그를 만든 뒤 `workflow_dispatch`로 Windows, macOS, GitHub Pages 워크플로를 명시적으로 호출합니다. 자동화 계정의 태그 push 자체에 후속 워크플로 시작을 맡기지 않습니다.

Windows workflow가 성공하면 GitHub Release에 다음 파일과 `latest.json`이 업로드됩니다.

- `*.msi`
- `*.msi.sig`
- `*.exe`
- `*.exe.sig`
- `latest.json`

updater는 기존 프로젝트의 MSI 우선 다운로드 정책에 맞춰 `windows-x86_64` 대상에서 MSI를 사용합니다. NSIS 파일은 수동 설치와 향후 확장을 위해 함께 게시합니다.

버전은 수동으로 편집하지 않습니다. 로컬 검증이나 자동화 디버깅에서 patch 증가가 필요할 때만 다음 명령을 사용합니다.

```bash
npm run version:bump
```

## 2) 수동 실행(Workflow Dispatch)

1. GitHub → Actions → `Windows Tauri Build` 열기
2. **Run workflow**에서 실행할 브랜치/태그를 선택하고 `release_tag` 입력 (예: `v1.0.7`)
3. 실행하면 선택한 ref의 workflow 실행 커밋(`GITHUB_SHA`) 기준으로 릴리스 artifact가 업로드됩니다.

수동 실행에서 `release_tag`가 아직 존재하지 않으면 workflow는 `gh release create --target "$GITHUB_SHA"`로 해당 태그에 release를 생성합니다. 이미 존재하는 태그라면 기본적으로 태그 SHA가 현재 workflow 실행 커밋과 같은지 확인하고, 다르면 asset 덮어쓰기를 중단합니다. 태그는 생성됐지만 GitHub Release가 만들어지지 않은 release-tooling hotfix를 복구할 때만 `rebuild_existing_tag=true`를 추가할 수 있으며, 이 경로는 기존 태그가 현재 커밋의 조상이고 허용된 release workflow 파일만 변경된 경우에 한정됩니다.

예를 들어 v1.0.8 Windows Release가 빌드 설정 오류로 게시되지 않은 경우에는 다음처럼 실행합니다.

```bash
gh workflow run windows-tauri.yml --ref main -f release_tag=v1.0.8 -f rebuild_existing_tag=true
```

`fix(release):`로 시작하는 release-tooling hotfix는 제품 코드 버전을 다시 올리지 않도록 자동 patch bump 대상에서 제외합니다.

## 3) 동작 정리

- PR/일반 검증:
  - Tauri updater artifact 생성을 끈 unsigned MSI/NSIS를 만듭니다.
  - Tauri signing 개인 키를 읽지 않습니다.
- release:
  - `TAURI_SIGNING_PRIVATE_KEY`와 `TAURI_UPDATER_PUBLIC_KEY`를 확인합니다.
  - Tauri가 설치 파일과 `.sig`를 생성합니다.
  - MSI `.sig`의 실제 내용을 `latest.json`의 `signature` 필드에 넣습니다.
  - GitHub Release에 설치 파일, signature, manifest를 게시합니다.
- 일반 `main` push / `pull_request`에서는 GitHub Release 업로드 job을 건너뜁니다.
- release workflow가 키 누락 또는 artifact/signature 누락으로 실패하면 불완전한 updater release를 게시하지 않습니다.

## 4) 무료 Tauri updater 키 설정

Tauri updater는 서명이 전혀 없는 업데이트를 허용하지 않습니다. 다만 이 서명은 유료 Windows Authenticode 인증서와 별개의 Tauri용 키 서명이며, 키 생성과 검증에는 인증서 구매 비용이 없습니다.

### 4.1 키 쌍 생성

개발 PC에서 프로젝트의 Tauri CLI로 키를 한 번 생성합니다.

```bash
npm exec -- tauri signer generate -w ~/.tauri/h-memo-updater.key
```

CLI가 출력하는 공개 키는 안전하게 공유할 수 있습니다. 생성된 개인 키 파일은 안전한 별도 백업 위치에도 보관하세요.

### 4.2 GitHub 설정

저장소 **Settings → Secrets and variables → Actions**에서 다음을 등록합니다.

Variable:

- `TAURI_UPDATER_PUBLIC_KEY`: Tauri CLI가 출력한 공개 키 전문

Secret:

- `TAURI_SIGNING_PRIVATE_KEY`: 개인 키 파일의 내용
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 개인 키에 비밀번호를 설정한 경우에만 등록

개인 키는 저장소 파일, 문서, workflow 출력, release artifact에 넣지 않습니다. 공개 키는 release 바이너리에 compile-time으로 포함되어 업데이트 signature를 검증합니다.

## 5) 버전 동기화 및 릴리스 태그

릴리스할 때는 다음 파일의 버전이 동일해야 합니다.

- `package.json` (repo root)
- `apps/desktop/package.json`
- `packages/*/package.json` (`memo-core`, `memo-ui`, `memo-sync`)
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

버전 정합성 확인:

```bash
npm run check:versions
npm run check:versions -- --release-tag v1.0.7
```

자동 버전 변경 절차:

1. 현재 상태를 `npm run check:versions`로 확인합니다.
2. `npm run version:bump`으로 모든 관리 대상의 patch 버전을 함께 올립니다.
3. 새 버전과 태그 형식이 맞는지 확인합니다. 예: `1.0.7`이면 태그는 `v1.0.7`입니다.

```bash
npm run check:versions -- --release-tag v1.0.7
```

`tauri.conf.json`의 앱 메타데이터도 현재 아래 값으로 함께 유지합니다.

- `productName`: `H Memo`
- `app.windows[0].title`: `H Memo`
- `identifier`: `com.hmemo.desktop`

## 6) updater manifest와 Windows 설치 방식

release job은 설치 파일을 먼저 GitHub Release에 게시한 뒤, GitHub가 최종 등록한 MSI asset명을 조회하여 [`scripts/create-updater-manifest.mjs`](../scripts/create-updater-manifest.mjs)에 전달합니다. 따라서 로컬 artifact명과 GitHub asset명의 공백/점 표기가 달라도 `latest.json`의 URL은 실제 게시 asset과 일치합니다. MSI `.sig` 내용도 함께 읽어 manifest에 넣습니다. 결과인 `latest.json`은 다음 고정 endpoint에 게시됩니다.

```text
https://github.com/WBmaker2/h-memo/releases/latest/download/latest.json
```

manifest에는 서명 파일의 URL이 아니라 서명 파일의 실제 내용이 들어가야 합니다. Tauri updater는 manifest를 읽고 HTTPS MSI를 다운로드한 뒤 공개 키로 signature를 검증하고 설치를 시작합니다.

첫 updater-enabled release 전의 기존 설치본은 이전 release에 manifest가 없으므로 자동 업데이트가 되지 않을 수 있습니다. 첫 배포 때는 현재 공개 다운로드 페이지에서 MSI를 한 번 수동 설치해야 합니다.

## 7) Windows에서 기대되는 보안 표시

이번 방식은 Windows Authenticode 서명을 하지 않으므로 설치 시 SmartScreen에서 게시자를 확인할 수 없다는 경고가 남을 수 있습니다. 이것은 정상적인 한계입니다. Tauri updater signature는 release payload가 바뀌거나 서명 키와 맞지 않을 때 설치를 거부하는 무결성 검증을 제공합니다.

따라서 사용자 안내에서는 다음을 분리해 설명합니다.

- Windows 게시자/SmartScreen 신뢰: Authenticode 인증서가 없으므로 경고가 남을 수 있음
- updater payload 무결성: Tauri 공개 키와 `.sig`가 맞지 않으면 설치하지 않음

## 8) 참고

- 이 workflow는 `gh` CLI로 release upload를 처리합니다. 별도 유료 서명 서비스나 써드파티 release action은 사용하지 않습니다.
- `scripts/verify-windows-signatures.ps1`는 과거 Authenticode 검토용 파일이며 현재 무료 Tauri updater release 경로에서는 호출하지 않습니다.
- macOS 정식 배포를 시작하려면 Apple Developer ID 서명, notarization, DMG 공증 후 GitHub Release 업로드 흐름을 별도 단계로 추가해야 합니다.
