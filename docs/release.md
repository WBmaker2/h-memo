# GitHub Release 자동화 가이드

`windows-tauri.yml` 워크플로우는 기존처럼 PR/브랜치 빌드에서는 MSI/NSIS 아티팩트를 업로드하고, 태그 기반 또는 수동 실행 시 GitHub Release까지 자동 업로드합니다. 일반 빌드 job은 `contents: read` 권한만 사용하고, 릴리스 업로드 job에서만 `contents: write` 권한을 사용합니다.

`macos-tauri.yml` 워크플로우는 Apple 유료 개발자 계정 없이 내부 테스트용 `.app`/`.dmg` 아티팩트만 생성합니다. macOS 아티팩트는 현재 GitHub Release에 자동 업로드하지 않습니다.

## 1) 자동 버전과 태그 릴리스

`main`에 실제 변경이 반영되고 CI가 성공하면 `Auto Version and Tag` 워크플로가 patch 버전을 1 올리고 `vX.Y.Z` 태그를 생성합니다. 이 워크플로는 태그를 만든 뒤 `workflow_dispatch`로 Windows, macOS, GitHub Pages 워크플로를 명시적으로 호출합니다. 자동화 계정의 태그 push 자체에 후속 워크플로 시작을 맡기지 않습니다.

Windows 워크플로가 성공하면 GitHub Release에 `*.msi`, `*.exe` 설치 파일이 업로드됩니다. macOS 워크플로는 내부 테스트 아티팩트를 만들고, Pages 워크플로는 태그 버전의 웹앱을 배포합니다.

버전은 수동으로 편집하지 않습니다. 로컬 검증이나 자동화 디버깅에서 patch 증가가 필요할 때만 다음 명령을 사용합니다.

```bash
npm run version:bump
```

## 2) 수동 실행(Workflow Dispatch)

1. GitHub → Actions → `Windows Tauri Build` 열기
2. **Run workflow**에서 실행할 브랜치/태그를 선택하고 `release_tag` 입력 (예: `v0.1.0`)
3. 실행하면 선택한 ref의 워크플로 실행 커밋(`GITHUB_SHA`) 기준으로 릴리스 아티팩트가 업로드됩니다.

수동 실행에서 `release_tag`가 아직 존재하지 않으면, 워크플로는 `gh release create --target "$GITHUB_SHA"`로 해당 태그를 워크플로 실행 커밋에 생성합니다. 이미 존재하는 태그라면 태그 SHA가 현재 워크플로 실행 커밋과 같은지 확인하고, 다르면 Release asset 덮어쓰기를 중단합니다.

## 3) 동작 정리

- 릴리스 실행 여부:
  - `Auto Version and Tag`가 새 태그를 생성한 뒤 `workflow_dispatch`로 Windows, macOS, Pages 워크플로를 호출
  - Windows 워크플로는 `release_tag` 입력으로 GitHub Release 업로드 수행
  - 수동 `workflow_dispatch`에서도 필요한 ref와 `release_tag`를 지정해 같은 릴리스 흐름을 실행 가능
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

자동 버전 변경 절차:

1. 현재 상태를 `npm run check:versions`로 확인합니다.
2. `npm run version:bump`으로 모든 관리 대상의 patch 버전을 함께 올립니다. 명령은 새 버전 문자열만 출력합니다.
3. 새 버전과 태그 형식이 맞는지 확인합니다. 예: `1.0.1`이면 태그는 `v1.0.1`입니다.

```bash
npm run check:versions -- --release-tag v1.0.1
```

자동화가 성공한 `main` 변경에 대해 태그를 생성한 뒤 세 배포 워크플로를 명시적으로 dispatch합니다. 수동 태그 생성은 예외 복구 절차에서만 사용합니다.

`tauri.conf.json`의 앱 메타데이터도 현재 아래 값으로 함께 유지해 주세요. (제품명/title/식별자 일관성)

- `productName`: `H Memo`
- `app.windows[0].title`: `H Memo`
- `identifier`: `com.hmemo.desktop`

Windows 코드 서명은 현재 미적용 상태이므로, 추후 배포 하드닝 항목으로 `codesign` 인증서 연동과 서명된 설치 파일 배포를 추가하는 것이 권장됩니다.

## 5) 참고

- 이 워크플로는 `gh` CLI로 release upload를 처리합니다. 별도 써드파티 릴리스 액션은 사용하지 않습니다.
- macOS 정식 배포를 시작하려면 Apple Developer ID 서명, notarization, DMG 공증 후 GitHub Release 업로드 흐름을 별도 단계로 추가해야 합니다.
