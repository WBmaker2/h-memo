# H Memo Promo Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Korean promotional web page for H Memo that explains the Windows memo app, guides Windows installation with the SmartScreen screenshots, and provides a reliable program download button backed by GitHub Release assets.

**Architecture:** Keep the existing `apps/web` memo preview intact, but make the first web screen a promotional landing page. Add a tiny route switch so the landing page is the default and the current memo web preview remains reachable as the future web-app surface. Resolve the Windows download URL from the public GitHub latest release API, then fall back to the GitHub Releases page if the release is not ready yet.

**Tech Stack:** Vite + React 19 + TypeScript, existing workspace packages, CSS in `apps/web/src/styles.css`, GitHub public release API, static image assets under `apps/web/public/install/`.

---

## Project Analysis

- The repo is a monorepo for `H Memo`, currently version `0.1.2`.
- `apps/desktop` is the Windows-first Tauri 2 desktop app. Its bundle targets are `nsis` and `msi`, and GitHub Actions uploads both installer types.
- `apps/web` already exists as a browser/PWA preview using the same `memo-core`, `memo-ui`, and `memo-sync` packages. It is currently an app surface, not a promotional page.
- `README.md`, `docs/build-windows.md`, `docs/release.md`, and `docs/windows-smoke-test.md` already describe the product, release workflow, installer artifacts, and Windows manual verification.
- Existing screenshots:
  - `h-memo-firebase-ready-menu.png` shows the current web/desktop-like memo menu and can be used as a product UI preview.
  - The two attached SmartScreen images should be saved into `apps/web/public/install/` during implementation:
    - `windows-smartscreen-more-info.png`
    - `windows-smartscreen-run-anyway.png`
- Because code signing is not yet applied, the page must explain SmartScreen honestly: users should download only from the official GitHub Release and proceed through `추가 정보` -> `실행` only when the file name matches the H Memo release asset.

## Page Strategy

The page should feel like a teacher/work utility landing page, not a generic startup hero.

Default URL:

- `/` or the deployed app root: H Memo promotional page
- `#/app`: current H Memo web preview app

Primary CTA:

- Text: `프로그램 다운로드`
- Runtime behavior:
  - Prefer latest release Windows `.msi` asset.
  - If no `.msi` is found, use the latest release NSIS `.exe` asset.
  - If the GitHub API fails or the release is still being published, open `https://github.com/WBmaker2/h-memo/releases/latest`.

Recommended section order:

1. Hero: product name, purpose, Windows download button, current/future platform badges.
2. School workflow value: school-work memos, local-first saving, Google backup.
3. Feature grid: multiple memo windows, style controls, local TXT/JSON backup, server backup/restore, startup registration, tray behavior.
4. Installation guide: download, run installer, SmartScreen `추가 정보`, SmartScreen `실행`.
5. Future roadmap strip: Windows now, macOS later, web app later.
6. Product preview / web preview link: show current H Memo screenshot and link to `#/app`.

## File Structure

- Create: `apps/web/src/landing/releaseDownload.ts`
  - Owns GitHub latest-release fetch, installer asset selection, and fallback URL.
- Create: `apps/web/src/landing/releaseDownload.test.ts`
  - Covers `.exe` priority, `.msi` fallback, Releases page fallback, and malformed API response fallback.
- Create: `apps/web/src/landing/LandingPage.tsx`
  - Owns promotional copy, download CTA, platform roadmap, install guide, and screenshot usage.
- Create: `apps/web/src/landing/LandingPage.test.tsx`
  - Covers Korean copy, download button behavior, SmartScreen image alt text, and `#/app` link.
- Create: `apps/web/src/AppRouter.tsx`
  - Shows `WebApp` when `window.location.hash === "#/app"` or `"#app"`; otherwise shows `LandingPage`.
- Modify: `apps/web/src/main.tsx`
  - Render `AppRouter` instead of `WebApp`.
- Modify: `apps/web/src/styles.css`
  - Add landing page layout and responsive styles while preserving existing memo styles.
- Modify: `apps/web/index.html`
  - Update title, description, theme color, and social metadata for the promotional page.
- Add assets:
  - `apps/web/public/install/windows-smartscreen-more-info.png`
  - `apps/web/public/install/windows-smartscreen-run-anyway.png`
  - `apps/web/public/install/h-memo-product-preview.png` copied from `h-memo-firebase-ready-menu.png` or replaced by a newer product screenshot.
- Modify: `README.md`
  - Add a short note that the web root is now the promotional page and the memo preview remains at `#/app`.

## Task 1: Download URL Resolver

**Files:**
- Create: `apps/web/src/landing/releaseDownload.ts`
- Create: `apps/web/src/landing/releaseDownload.test.ts`

- [ ] **Step 1: Add failing tests for release asset selection**

Create tests with these cases:

- latest release contains `H Memo_0.1.2_x64-setup.exe` and `H Memo_0.1.2_x64_en-US.msi`: choose the `.msi`
- latest release contains only `.exe`: choose the `.exe`
- latest release contains no Windows installer: use `https://github.com/WBmaker2/h-memo/releases/latest`
- fetch rejects: use `https://github.com/WBmaker2/h-memo/releases/latest`

Run:

```bash
npm test -- apps/web/src/landing/releaseDownload.test.ts
```

Expected before implementation: FAIL because `releaseDownload.ts` does not exist.

- [ ] **Step 2: Implement the resolver**

Use these exported names:

```ts
export const GITHUB_RELEASES_LATEST_URL = "https://github.com/WBmaker2/h-memo/releases/latest";
export const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/WBmaker2/h-memo/releases/latest";

export type ReleaseDownloadState = {
  url: string;
  label: string;
  source: "github-asset" | "fallback";
};

export async function resolveWindowsDownloadUrl(fetcher = fetch): Promise<ReleaseDownloadState>;
```

Selection rules:

- Asset names ending with `.msi` and including `x64` win over `.exe`.
- `.exe` with `x64` is second choice.
- Any valid `browser_download_url` must be returned unchanged.
- If parsing fails, return the fallback URL with source `fallback`.

- [ ] **Step 3: Verify tests pass**

Run:

```bash
npm test -- apps/web/src/landing/releaseDownload.test.ts
```

Expected: PASS.

## Task 2: Landing Page, Route Switch, And Assets

**Files:**
- Create: `apps/web/src/landing/LandingPage.tsx`
- Create: `apps/web/src/AppRouter.tsx`
- Modify: `apps/web/src/main.tsx`
- Add: `apps/web/public/install/windows-smartscreen-more-info.png`
- Add: `apps/web/public/install/windows-smartscreen-run-anyway.png`
- Add: `apps/web/public/install/h-memo-product-preview.png`

- [ ] **Step 1: Save image assets**

Place the attached SmartScreen screenshots at:

```text
apps/web/public/install/windows-smartscreen-more-info.png
apps/web/public/install/windows-smartscreen-run-anyway.png
```

Copy the existing product screenshot:

```text
h-memo-firebase-ready-menu.png
```

to:

```text
apps/web/public/install/h-memo-product-preview.png
```

- [ ] **Step 2: Create the landing component**

The page must include these exact visible Korean copy anchors:

- `H Memo`
- `학교 업무에 필요한 메모를 저장하고 백업하는 Windows 메모앱`
- `프로그램 다운로드`
- `Windows용 먼저 제공`
- `macOS용 앱은 추후 제공 예정`
- `웹 브라우저용 웹앱도 개발 및 배포 예정`
- `Microsoft Defender SmartScreen 안내`
- `추가 정보를 누른 뒤 실행을 선택합니다`
- `웹 미리보기 열기`

The install guide must use image alt text:

- `Windows SmartScreen 화면에서 추가 정보가 강조된 모습`
- `Windows SmartScreen 화면에서 실행 버튼이 강조된 모습`

The SmartScreen warning copy must say that the current early release is unsigned and users should verify the official GitHub Release source before running the installer.

- [ ] **Step 3: Add a route switch**

Create `AppRouter` with this behavior:

- `#/app` or `#app` renders `<WebApp />`
- any other hash renders `<LandingPage />`
- when the hash changes, the rendered screen updates without a full reload

Modify `apps/web/src/main.tsx` so it renders `<AppRouter />`.

- [ ] **Step 4: Add tests**

Add `LandingPage.test.tsx` and route tests for:

- landing page is the default screen
- `프로그램 다운로드` has a fallback link immediately
- resolved GitHub asset updates the button href
- SmartScreen images render with correct alt text
- `#/app` renders the existing heading `H Memo (웹 미리보기)`

Run:

```bash
npm test -- apps/web/src/landing/LandingPage.test.tsx apps/web/src/WebApp.test.tsx
```

Expected: PASS.

## Task 3: Visual Styling And Metadata

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/index.html`
- Modify: `README.md`

- [ ] **Step 1: Add landing CSS**

Design constraints:

- Use a restrained teacher/work utility palette: memo yellow, ink navy, cloud blue, white, and slate.
- Avoid a one-color purple theme.
- Do not use nested cards.
- Keep repeated feature cards at `border-radius: 8px` or less.
- Ensure text never overlaps on mobile.
- Keep screenshots inspectable, not heavily blurred or darkened.
- Use responsive grid constraints for feature and install sections.

- [ ] **Step 2: Update web metadata**

Set:

```html
<meta name="description" content="H Memo는 학교 업무에 필요한 메모를 저장하고 로컬 및 서버 백업으로 안전하게 보관하는 Windows 메모앱입니다." />
<meta name="theme-color" content="#facc15" />
<meta property="og:title" content="H Memo - 학교 업무 메모 백업 앱" />
<meta property="og:description" content="Windows에서 빠르게 메모하고 TXT, JSON, Google 서버 백업으로 다시 꺼내는 H Memo." />
<title>H Memo - 학교 업무 메모 백업 앱</title>
```

- [ ] **Step 3: Update README**

Add a short section:

```md
## 홍보 페이지와 웹 미리보기

- 웹 루트는 H Memo 소개/다운로드 페이지입니다.
- 기존 브라우저 메모 미리보기는 `#/app`에서 확인할 수 있습니다.
```

- [ ] **Step 4: Run full web verification**

Run:

```bash
npm test -- apps/web/src/landing/releaseDownload.test.ts apps/web/src/landing/LandingPage.test.tsx apps/web/src/WebApp.test.tsx
npm run build -w apps/web
```

Expected: PASS.

- [ ] **Step 5: Browser verification**

Start local preview:

```bash
npm run dev -w apps/web
```

Verify in the browser:

- desktop width shows hero, download button, product screenshot, and install guide without overlap
- mobile width shows the same content in a single column
- download button opens a GitHub URL
- `#/app` opens the memo web preview
- `#/` returns to the promotional page

## Task 4: Subagent Execution And Review Gates

**Files:**
- No direct code files. This task governs implementation workflow.

- [ ] **Step 1: Dispatch implementer subagent per task after approval**

Use `GPT-5.3-Codex-Spark` for implementer subagents if available, following the repo AGENTS.md instruction. If that model/token pool is unavailable, use the main model.

- [ ] **Step 2: Review after each task**

For each implementation task:

- Spec compliance review first.
- Code quality review second.
- Do not proceed while review issues remain open.

- [ ] **Step 3: Final verification**

Before reporting completion:

```bash
npm test
npm run typecheck
npm run build
```

Also perform browser verification for the landing page and `#/app`.

## Open Questions Before Implementation

1. The attached SmartScreen images are visible in this conversation, but they may not exist as files inside the repo. If Codex cannot access the attachment files directly during implementation, the user should place them in the workspace or provide their file paths.
2. The final direct download URL depends on the exact GitHub Release asset names after the current public release finishes. The resolver avoids hard-coding asset names, so implementation can proceed before the release completes.
3. If the user wants a separate static marketing site instead of making `apps/web` root the promotional page, create a separate `apps/landing` package. Current recommendation is to reuse `apps/web` because it is already the future browser surface.

## Self-Review

- Spec coverage: The plan covers project analysis, purpose copy, features/advantages, Windows installation guide with screenshots, future macOS/web messaging, and a download button tied to GitHub Release assets.
- Placeholder scan: No `TBD`, `TODO`, or unspecified test command remains.
- Type consistency: The planned resolver exports `ReleaseDownloadState` and `resolveWindowsDownloadUrl`, and tests should import those exact names.
