# GitHub Release 자동화 가이드 (Windows)

`windows-tauri.yml` 워크플로우는 PR/브랜치 빌드에서는 MSI/NSIS 아티팩트를 업로드하고, 태그 기반 또는 수동 실행 시 GitHub Release까지 자동 업로드합니다. Azure Artifact Signing 구성이 준비된 빌드에서는 업로드 전에 Windows 설치 파일(`*.msi`, NSIS `*.exe`)을 서명합니다. 릴리스 빌드에서 서명 구성이 빠져 있으면 워크플로가 실패하도록 막아 둡니다.

## 1) 태그 기반 릴리스

1. 릴리스 태그를 생성합니다.
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
2. `push` 이벤트(`v*` 태그)로 `Windows Tauri Build` 워크플로가 실행됩니다.
3. 빌드가 성공하면 GitHub Release가 생성되며, `*.msi`, `*.exe` 설치 파일이 업로드됩니다.

## 2) 수동 실행(Workflow Dispatch)

1. GitHub → Actions → `Windows Tauri Build` 열기
2. **Run workflow**에서 실행할 브랜치/태그를 선택하고 `release_tag` 입력 (예: `v0.1.0`)
3. 실행하면 선택한 ref의 워크플로 실행 커밋(`GITHUB_SHA`) 기준으로 릴리스 아티팩트가 업로드됩니다.

수동 실행에서 `release_tag`가 아직 존재하지 않으면, 워크플로는 `gh release create --target "$GITHUB_SHA"`로 해당 태그를 워크플로 실행 커밋에 생성합니다. 이미 존재하는 태그라면 태그 SHA가 현재 워크플로 실행 커밋과 같은지 확인하고, 다르면 Release asset 덮어쓰기를 중단합니다.

## 3) 동작 정리

- 릴리스 실행 여부:
  - 태그 푸시(`refs/tags/v*`)에서만 릴리스 업로드 수행
  - `workflow_dispatch` 입력 `release_tag`에서도 릴리스 업로드 수행
  - 일반 `main` push / `pull_request`에서는 GitHub Release 업로드 job을 건너뜀
- 권한:
  - 빌드/테스트/아티팩트 업로드 job: `contents: read`, Azure OIDC 로그인을 위한 `id-token: write`
  - GitHub Release 업로드 job: `contents: write`
- 아티팩트:
  - `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
  - `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`
- Azure Artifact Signing:
  - `pull_request`: 항상 건너뜀
  - 일반 `main` push: 구성이 있으면 서명, 없으면 경고 후 unsigned artifact 업로드
  - 태그/수동 릴리스: 구성이 없으면 실패

## 4) 버전 동기화 및 릴리스 태그

릴리스할 때는 다음 파일의 버전이 동일해야 합니다.

- `package.json` (repo root)
- `apps/desktop/package.json`
- `packages/*/package.json` (`memo-core`, `memo-ui`, `memo-sync`)
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

버전 정합성 확인:

```bash
npm run check:versions
npm run check:versions -- --release-tag v0.2.0
```

버전 변경 절차:

1. 상기 항목의 `version`을 모두 동일한 값으로 갱신합니다. 예: `0.1.0` → `0.2.0`
2. `npm run check:versions -- --release-tag v0.2.0`로 버전/태그 일치 여부 확인
3. 커밋 후 태그를 생성합니다. 태그는 `v` 접두사와 동일한 버전이어야 합니다.

```bash
git tag v0.2.0
git push origin v0.2.0
```

4. 일반 릴리스 진행 방식(수동/태그 push)에 따라 `Windows Tauri Build` 워크플로가 실행됩니다.

`tauri.conf.json`의 앱 메타데이터도 현재 아래 값으로 함께 유지해 주세요. (제품명/title/식별자 일관성)

- `productName`: `H Memo`
- `app.windows[0].title`: `H Memo`
- `identifier`: `com.hmemo.desktop`

## 5) Azure Artifact Signing 설정

GitHub Actions에서 Azure Artifact Signing을 사용하려면 Azure 쪽 준비와 GitHub repository secrets/variables 설정이 모두 필요합니다.

Azure 준비:

- Artifact Signing account
- Certificate profile
- GitHub Actions OIDC federated credential이 연결된 Microsoft Entra app registration 또는 service principal
- 해당 identity에 `Artifact Signing Certificate Profile Signer` 역할 부여

GitHub Actions 값:

| 이름 | 권장 위치 | 설명 |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | secret 또는 variable | Azure login에 사용할 app registration/client ID |
| `AZURE_TENANT_ID` | secret 또는 variable | Microsoft Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | secret 또는 variable | Azure subscription ID |
| `AZURE_ARTIFACT_SIGNING_ENDPOINT` | variable | 예: `https://krc.codesigning.azure.net/` |
| `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME` | variable | Artifact Signing account 이름 |
| `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME` | variable | Certificate profile 이름 |

서명은 `Build Windows installer (MSI + NSIS)` 이후, `Upload MSI artifact` / `Upload NSIS installer artifact` 이전에 실행됩니다. 따라서 GitHub Release에 올라가는 설치 파일은 서명된 파일이어야 합니다.

서명 여부 확인 예:

```powershell
Get-AuthenticodeSignature ".\H Memo_0.1.0_x64-setup.exe"
Get-AuthenticodeSignature ".\H Memo_0.1.0_x64_en-US.msi"
```

## 6) 참고

- 이 워크플로는 `gh` CLI로 release upload를 처리합니다. 별도 써드파티 릴리스 액션은 사용하지 않습니다.
