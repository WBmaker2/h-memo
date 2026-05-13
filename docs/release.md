# GitHub Release 자동화 가이드 (Windows)

`windows-tauri.yml` 워크플로우는 기존처럼 PR/브랜치 빌드에서는 MSI/NSIS 아티팩트를 업로드하고, 태그 기반 또는 수동 실행 시 GitHub Release까지 자동 업로드합니다. 일반 빌드 job은 `contents: read` 권한만 사용하고, 릴리스 업로드 job에서만 `contents: write` 권한을 사용합니다.

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

수동 실행에서 `release_tag`가 아직 존재하지 않으면, 워크플로는 `gh release create --target "$GITHUB_SHA"`로 해당 태그를 워크플로 실행 커밋에 생성합니다. 이미 존재하는 태그라면 태그 위치를 바꾸지 않고, 같은 태그의 Release에 MSI/NSIS 설치 파일만 업로드합니다.

## 3) 동작 정리

- 릴리스 실행 여부:
  - 태그 푸시(`refs/tags/v*`)에서만 릴리스 업로드 수행
  - `workflow_dispatch` 입력 `release_tag`에서도 릴리스 업로드 수행
  - 일반 `main` push / `pull_request`에서는 업로드 스텝을 건너뜀
- 권한:
  - 빌드/테스트/아티팩트 업로드 job: `contents: read`
  - GitHub Release 업로드 job: `contents: write`
- 아티팩트:
  - `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
  - `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`

## 4) 참고

- 이 워크플로는 `gh` CLI로 release upload를 처리합니다. 별도 써드파티 릴리스 액션은 사용하지 않습니다.
