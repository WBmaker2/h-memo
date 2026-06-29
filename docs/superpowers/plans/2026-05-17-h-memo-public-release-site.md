# H Memo Public Release Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish H Memo's public download surface through `WBmaker2/h-memo-releases`, so users can open the promo page and download Windows installers without GitHub login.

**Architecture:** Keep all product source code in the private `WBmaker2/h-memo` repository. Use the public `WBmaker2/h-memo-releases` repository only for GitHub Release assets and the built static promo page on GitHub Pages. The web app's download resolver calls the public repo's `releases/latest` API, then falls back to a static `download-manifest.json` on GitHub Pages. If neither source exposes an installer URL, the download button remains disabled instead of sending users to a GitHub Releases page.

**Tech Stack:** GitHub CLI, GitHub Releases, GitHub Pages, Vite, React, TypeScript, Vitest.

---

## File Structure

- Modify: `apps/web/src/landing/releaseDownload.ts`
  - Change latest-release API constant from `WBmaker2/h-memo` to `WBmaker2/h-memo-releases`.
  - Keep `.msi` first, `.exe` second behavior.
  - Add a public `download-manifest.json` fallback and disable the button when no installer URL is available.
- Modify: `apps/web/src/landing/releaseDownload.test.ts`
  - Cover public latest-release API, manifest fallback, MSI-first, EXE fallback, and malformed-response behavior.
- Modify: `apps/web/src/landing/LandingPage.test.tsx`
  - Update mocked resolved asset URL to the public repo.
  - Confirm the UI does not expose a GitHub Releases page link or MSI-first release-page copy.
- Modify: `apps/web/vite.config.ts`
  - Add a build-time base path from `H_MEMO_WEB_BASE_PATH`, defaulting to `/`.
  - GitHub Pages build uses `/h-memo-releases/`.
- Modify: `README.md`
  - Document that the promo page is built from the private repo and deployed to the public `h-memo-releases` repo.
- Create or update externally: `WBmaker2/h-memo-releases`
  - Public repository.
  - Release `v0.1.2` containing `H.Memo_0.1.2_x64_en-US.msi` and `H.Memo_0.1.2_x64-setup.exe`.
  - `gh-pages` branch containing the built static promo page.

## Task 1: Prepare Public Release Repository And Assets

**Files:**
- External: `WBmaker2/h-memo-releases`
- Read source assets from: `WBmaker2/h-memo` release `v0.1.2`

- [ ] **Step 1: Check whether the public release repo exists**

Run:

```bash
gh repo view WBmaker2/h-memo-releases --json nameWithOwner,visibility,url
```

Expected when it already exists:

```json
{"nameWithOwner":"WBmaker2/h-memo-releases","url":"https://github.com/WBmaker2/h-memo-releases","visibility":"PUBLIC"}
```

Expected when it does not exist: `gh` exits non-zero with a not-found message.

- [ ] **Step 2: Create the public repo if missing**

Run:

```bash
gh repo create WBmaker2/h-memo-releases --public --description "Public releases and download page for H Memo"
```

Expected: GitHub creates `https://github.com/WBmaker2/h-memo-releases` as a public repo.

- [ ] **Step 3: Download installer assets from private release `v0.1.2`**

Run:

```bash
mkdir -p /private/tmp/h-memo-v0.1.2-assets
gh release download v0.1.2 --repo WBmaker2/h-memo --pattern "H.Memo_0.1.2_x64_en-US.msi" --pattern "H.Memo_0.1.2_x64-setup.exe" --dir /private/tmp/h-memo-v0.1.2-assets --clobber
ls -lh /private/tmp/h-memo-v0.1.2-assets
```

Expected: both files are present:

```text
H.Memo_0.1.2_x64-setup.exe
H.Memo_0.1.2_x64_en-US.msi
```

- [ ] **Step 4: Create or update the public release**

Run this first:

```bash
gh release view v0.1.2 --repo WBmaker2/h-memo-releases
```

If the release does not exist, run:

```bash
gh release create v0.1.2 /private/tmp/h-memo-v0.1.2-assets/H.Memo_0.1.2_x64_en-US.msi /private/tmp/h-memo-v0.1.2-assets/H.Memo_0.1.2_x64-setup.exe --repo WBmaker2/h-memo-releases --title "H Memo v0.1.2" --notes "Public Windows installer mirror for H Memo v0.1.2."
```

If the release exists, run:

```bash
gh release upload v0.1.2 /private/tmp/h-memo-v0.1.2-assets/H.Memo_0.1.2_x64_en-US.msi /private/tmp/h-memo-v0.1.2-assets/H.Memo_0.1.2_x64-setup.exe --repo WBmaker2/h-memo-releases --clobber
```

Expected: `v0.1.2` in the public repo has both installer assets.

- [ ] **Step 5: Verify anonymous download visibility**

Run:

```bash
curl -I https://github.com/WBmaker2/h-memo-releases/releases/latest
curl -I https://github.com/WBmaker2/h-memo-releases/releases/download/v0.1.2/H.Memo_0.1.2_x64_en-US.msi
```

Expected: the release page returns a redirect/OK response instead of `404`, and the asset URL redirects to downloadable storage instead of requiring login.

## Task 2: Point The Download Button At The Public Release Repo

**Files:**
- Modify: `apps/web/src/landing/releaseDownload.ts`
- Modify: `apps/web/src/landing/releaseDownload.test.ts`
- Modify: `apps/web/src/landing/LandingPage.test.tsx`

- [ ] **Step 1: Write the expected public download behavior in tests**

In `apps/web/src/landing/releaseDownload.test.ts`, latest-release API expectations must use:

```ts
"https://api.github.com/repos/WBmaker2/h-memo-releases/releases/latest"
```

Add manifest fallback coverage for `download-manifest.json`, with `.msi` preferred over `.exe` and a disabled-state fallback when both sources fail.

In `apps/web/src/landing/LandingPage.test.tsx`, update `RESOLVED_DOWNLOAD_STATE.url` to:

```ts
"https://github.com/WBmaker2/h-memo-releases/releases/download/v0.1.2/H.Memo_0.1.2_x64_en-US.msi"
```

- [ ] **Step 2: Run the focused tests and confirm they fail before implementation**

Run:

```bash
npm test -- apps/web/src/landing/releaseDownload.test.ts apps/web/src/landing/LandingPage.test.tsx
```

Expected: tests fail because production constants still point at `WBmaker2/h-memo`.

- [ ] **Step 3: Change production constants**

In `apps/web/src/landing/releaseDownload.ts`, set:

```ts
export const GITHUB_LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/WBmaker2/h-memo-releases/releases/latest";
export const DOWNLOAD_MANIFEST_PATH = "download-manifest.json";
```

Keep `chooseWindowsInstaller()` unchanged so `.msi` is preferred over `.exe`, and use `download-manifest.json` as the non-UI fallback when the latest release API is unavailable or does not expose a Windows installer.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- apps/web/src/landing/releaseDownload.test.ts apps/web/src/landing/LandingPage.test.tsx
```

Expected: both landing/download test files pass.

## Task 3: Make The Promo Page Buildable For GitHub Pages

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `README.md`

- [ ] **Step 1: Add Vite base-path support**

In `apps/web/vite.config.ts`, use:

```ts
export default defineConfig({
  base: process.env.H_MEMO_WEB_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["../../vitest.setup.ts"],
  },
});
```

Expected: local builds keep `/`; GitHub Pages builds can use `/h-memo-releases/`.

- [ ] **Step 2: Document the public deployment surface**

In `README.md`, extend `## 홍보 페이지와 웹 미리보기` with:

```md
- 공개 홍보 페이지는 이 private repo에서 빌드한 정적 파일을 public `WBmaker2/h-memo-releases` repo의 GitHub Pages에 배포합니다.
- 공개 다운로드 버튼은 public `WBmaker2/h-memo-releases`의 최신 릴리스에서 Windows `.msi`를 우선 찾고, 없으면 `.exe`를 사용합니다.
- 최신 릴리스 API를 사용할 수 없을 때는 public Pages의 `download-manifest.json`을 fallback으로 사용하며, 그래도 설치 파일 URL이 없으면 버튼을 비활성 상태로 유지합니다.
```

- [ ] **Step 3: Run web build with the public base path**

Run:

```bash
H_MEMO_WEB_BASE_PATH=/h-memo-releases/ npm run build -w apps/web
```

Expected: `apps/web/dist/index.html` references assets under `/h-memo-releases/`.

## Task 4: Publish The Promo Page To GitHub Pages

**Files:**
- Generated: `apps/web/dist/`
- External: `WBmaker2/h-memo-releases` `gh-pages` branch

- [ ] **Step 1: Build the promo page for public Pages**

Run:

```bash
H_MEMO_WEB_BASE_PATH=/h-memo-releases/ npm run build -w apps/web
```

Expected: `apps/web/dist/` contains the built promo page.

- [ ] **Step 2: Push the built page to the public repo's `gh-pages` branch**

Run:

```bash
rm -rf /private/tmp/h-memo-releases-pages
git clone https://github.com/WBmaker2/h-memo-releases.git /private/tmp/h-memo-releases-pages
cd /private/tmp/h-memo-releases-pages
git switch --orphan gh-pages
git rm -rf .
cp -R /Users/kimhongnyeon/Dev/codex/h-memo/apps/web/dist/. .
touch .nojekyll
git add .
git commit -m "deploy: publish H Memo promo page"
git push origin gh-pages --force
```

Expected: `gh-pages` branch contains the static site only.

- [ ] **Step 3: Enable GitHub Pages from `gh-pages`**

Run:

```bash
gh api repos/WBmaker2/h-memo-releases/pages
```

If Pages is not configured, run:

```bash
gh api repos/WBmaker2/h-memo-releases/pages -X POST -f source[branch]=gh-pages -f source[path]=/
```

If Pages exists but uses a different source, run:

```bash
gh api repos/WBmaker2/h-memo-releases/pages -X PUT -f source[branch]=gh-pages -f source[path]=/
```

Expected: GitHub Pages serves from `gh-pages` and root path.

## Task 5: Verify The Full Public Flow

**Files:**
- Verify local files and public URLs.

- [ ] **Step 1: Run local validation**

Run:

```bash
npm test -- apps/web/src/landing/releaseDownload.test.ts apps/web/src/landing/LandingPage.test.tsx
npm run typecheck
npm run build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Verify public release API has a Windows installer**

Run:

```bash
gh api repos/WBmaker2/h-memo-releases/releases/latest --jq '.assets[].name'
```

Expected:

```text
H.Memo_0.1.2_x64-setup.exe
H.Memo_0.1.2_x64_en-US.msi
```

- [ ] **Step 3: Verify public site URL**

Run:

```bash
curl -I https://wbmaker2.github.io/h-memo-releases/
```

Expected: `HTTP/2 200` or a redirect that resolves to `200`.

- [ ] **Step 4: Browser smoke the public and local pages**

Open:

```text
https://wbmaker2.github.io/h-memo-releases/
```

Expected:
- The page shows `H Memo`.
- The `프로그램 다운로드` button resolves to the public repo `.msi` asset when the GitHub API is reachable.
- The SmartScreen images load.
- `웹 미리보기 열기` opens `#/app`.

## Self-Review

- Spec coverage: The plan covers a public repo, public release assets, public Pages hosting, download resolver changes, README documentation, tests, build, and browser/public verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified error handling remains.
- Type consistency: The existing `ReleaseDownloadState` shape remains unchanged; only repo URLs and Vite base configuration change.
