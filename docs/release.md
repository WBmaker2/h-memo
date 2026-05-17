# GitHub Release 자동화 가이드

`windows-tauri.yml` 워크플로우는 기존처럼 PR/브랜치 빌드에서는 MSI/NSIS 아티팩트를 업로드하고, 태그 기반 또는 수동 실행 시 GitHub Release까지 자동 업로드합니다. 일반 빌드 job은 `contents: read` 권한만 사용하고, 릴리스 업로드 job에서만 `contents: write` 권한을 사용합니다.

`macos-tauri.yml` 워크플로우는 Apple 유료 개발자 계정 없이 내부 테스트용 `.app`/`.dmg` 아티팩트만 생성합니다. macOS 아티팩트는 현재 GitHub Release에 자동 업로드하지 않습니다.

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
  - 빌드/테스트/아티팩트 업로드 job: `contents: read`
  - GitHub Release 업로드 job: `contents: write`
- 아티팩트:
  - `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
  - `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`

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

Windows 코드 서명은 현재 미적용 상태이므로, 추후 배포 하드닝 항목으로 `codesign` 인증서 연동과 서명된 설치 파일 배포를 추가하는 것이 권장됩니다.

## 5) 참고

- 이 워크플로는 `gh` CLI로 release upload를 처리합니다. 별도 써드파티 릴리스 액션은 사용하지 않습니다.
- macOS 정식 배포를 시작하려면 Apple Developer ID 서명, notarization, DMG 공증 후 GitHub Release 업로드 흐름을 별도 단계로 추가해야 합니다.
