# H Memo Shared DB Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current `apps/web` preview into a usable H Memo web app that signs in with Google and uses the same Firebase/Firestore DB as the Windows/macOS desktop apps.

**Architecture:** Keep the first web release compatible with the current production desktop DB paths: `users/{uid}/backupSnapshots/{snapshotId}` and `users/{uid}/serverMemoDeletes/{memoId}`. This makes the web app immediately interoperable with the released Windows/macOS backup data. Realtime per-memo sync through `users/{uid}/memos/{memoId}` remains the next migration phase, because desktop apps do not yet write that model.

**Tech Stack:** React 19, TypeScript, Vite, Firebase Auth, Cloud Firestore, existing `@h-memo/memo-core`, `@h-memo/memo-sync`, `@h-memo/memo-ui`, GitHub Actions Pages deployment.

---

## Implementation Boundary

This plan builds the **shared DB web app MVP**:

- Web app uses the same Firebase project and Google Auth as desktop.
- Web app reads/writes the same existing Firestore backup DB used by desktop:
  - `users/{uid}/backupSnapshots/{snapshotId}`
  - `users/{uid}/serverMemoDeletes/{memoId}`
- Web app supports local browser editing, Google login, server backup, server restore, server memo management, TXT export, JSON backup/restore, and PWA install basics.
- Web app does not yet implement realtime per-keystroke sync. Manual/explicit backup and restore remain the shared-data contract for this MVP.

## File Structure

- Modify `apps/web/src/WebApp.tsx`
  - Promote title from preview to production wording.
  - Add server memo manager state and handlers.
  - Wire `listBackedUpMemos` and `deleteBackedUpMemo` from `@h-memo/memo-sync`.
  - Expose a `서버 메모 관리` action in the app menu.
- Modify `apps/web/src/WebApp.test.tsx`
  - Add tests for login, server memo list, restore selected memo, delete selected server memo, and empty server list.
  - Keep current localStorage, JSON, TXT tests.
- Create `packages/memo-ui/src/ServerMemoManagerDialog.tsx`
  - Reusable modal/dialog for server memo list management.
  - Accepts already-loaded server memo items from the app layer.
- Create `packages/memo-ui/src/ServerMemoManagerDialog.test.tsx`
  - Component-level behavior and accessibility tests.
- Modify `packages/memo-ui/src/index.ts`
  - Export `ServerMemoManagerDialog`.
- Modify `.github/workflows/web-pages.yml`
  - New workflow to build and deploy `apps/web/dist` to GitHub Pages.
- Modify `apps/web/vite.config.ts`
  - Add GitHub Pages-aware base path.
- Modify `apps/web/src/manifest.test.ts`
  - Ensure manifest remains valid under non-root base paths.
- Modify `docs/web-roadmap.md`
  - Update from “웹 미리보기” to “공유 DB 웹앱 MVP”.
- Modify `docs/firebase-setup.md`
  - Add web deployment domain authorization checklist.
- Modify `README.md`
  - Add web app run/build/deploy notes.

---

### Task 1: Add Reusable Server Memo Manager UI

**Files:**
- Create: `packages/memo-ui/src/ServerMemoManagerDialog.tsx`
- Create: `packages/memo-ui/src/ServerMemoManagerDialog.test.tsx`
- Modify: `packages/memo-ui/src/index.ts`

- [ ] **Step 1: Write the failing component test**

Create `packages/memo-ui/src/ServerMemoManagerDialog.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import { ServerMemoManagerDialog } from "./ServerMemoManagerDialog";

const backedUpMemos = [
  {
    memo: createMemo({
      id: "server-memo-1",
      now: "2026-05-17T09:00:00.000Z",
      plainText: "서버에 저장된 메모",
    }),
    backupCreatedAt: "2026-05-17T09:05:00.000Z",
  },
];

describe("ServerMemoManagerDialog", () => {
  it("renders server memo cards and exposes restore/delete/refresh actions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const onRestore = vi.fn();
    const onDelete = vi.fn();

    render(
      <ServerMemoManagerDialog
        isOpen
        isBusy={false}
        items={backedUpMemos}
        status="서버 메모 1개"
        onClose={onClose}
        onRefresh={onRefresh}
        onRestore={onRestore}
        onDelete={onDelete}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "서버 메모 관리" });
    expect(within(dialog).getByText("서버에 저장된 메모")).toBeInTheDocument();
    expect(within(dialog).getByText("백업 시각: 2026-05-17T09:05:00.000Z")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "새로고침" }));
    await user.click(within(dialog).getByRole("button", { name: "서버에 저장된 메모 복원" }));
    await user.click(within(dialog).getByRole("button", { name: "서버에 저장된 메모 서버 삭제" }));
    await user.click(within(dialog).getByRole("button", { name: "닫기" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("server-memo-1");
    expect(onDelete).toHaveBeenCalledWith("server-memo-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no server memos", () => {
    render(
      <ServerMemoManagerDialog
        isOpen
        isBusy={false}
        items={[]}
        status="서버에 저장된 메모가 없습니다."
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "서버 메모 관리" })).toBeInTheDocument();
    expect(screen.getByText("서버에 저장된 메모가 없습니다.")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <ServerMemoManagerDialog
        isOpen={false}
        isBusy={false}
        items={backedUpMemos}
        status=""
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog", { name: "서버 메모 관리" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- packages/memo-ui/src/ServerMemoManagerDialog.test.tsx
```

Expected: FAIL because `ServerMemoManagerDialog.tsx` does not exist.

- [ ] **Step 3: Implement the dialog component**

Create `packages/memo-ui/src/ServerMemoManagerDialog.tsx`:

```tsx
import type { BackedUpMemo } from "@h-memo/memo-sync";

export type ServerMemoManagerDialogProps = {
  isOpen: boolean;
  isBusy: boolean;
  items: BackedUpMemo[];
  status: string;
  onClose: () => void;
  onRefresh: () => void;
  onRestore: (memoId: string) => void;
  onDelete: (memoId: string) => void;
};

function getMemoLabel(item: BackedUpMemo, index: number) {
  const text = item.memo.plainText.trim().replace(/\s+/g, " ");
  return text || `빈 메모 ${index + 1}`;
}

export function ServerMemoManagerDialog({
  isOpen,
  isBusy,
  items,
  status,
  onClose,
  onRefresh,
  onRestore,
  onDelete,
}: ServerMemoManagerDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="server-memo-dialog-backdrop">
      <section
        aria-label="서버 메모 관리"
        aria-modal="true"
        className="server-memo-dialog"
        role="dialog"
      >
        <div className="server-memo-dialog__header">
          <h2>서버 메모 관리</h2>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <p>DB에 저장된 메모를 확인하고 필요한 메모는 복원할 수 있습니다.</p>
        <p role="status">{status}</p>

        <button type="button" disabled={isBusy} onClick={onRefresh}>
          새로고침
        </button>

        {items.length === 0 ? (
          <p>서버에 저장된 메모가 없습니다.</p>
        ) : (
          <ul className="server-memo-list">
            {items.map((item, index) => {
              const label = getMemoLabel(item, index);
              return (
                <li key={item.memo.id} className="server-memo-list__item">
                  <h3>{label}</h3>
                  <p>백업 시각: {item.backupCreatedAt}</p>
                  <div>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`${label} 복원`}
                      onClick={() => onRestore(item.memo.id)}
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`${label} 서버 삭제`}
                      onClick={() => onDelete(item.memo.id)}
                    >
                      서버 삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Export the component**

Modify `packages/memo-ui/src/index.ts`:

```ts
export * from "./MemoToolbar";
export * from "./MemoWorkspace";
export * from "./SettingsPanel";
export * from "./StickyMemo";
export * from "./ServerMemoManagerDialog";
export * from "./theme";
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- packages/memo-ui/src/ServerMemoManagerDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/memo-ui/src/ServerMemoManagerDialog.tsx packages/memo-ui/src/ServerMemoManagerDialog.test.tsx packages/memo-ui/src/index.ts
git commit -m "feat: add server memo manager dialog"
```

---

### Task 2: Wire Server Memo Management Into WebApp

**Files:**
- Modify: `apps/web/src/WebApp.tsx`
- Modify: `apps/web/src/WebApp.test.tsx`

- [ ] **Step 1: Add failing WebApp tests for server memo management**

Append these tests inside `describe("WebApp", () => { ... })` in `apps/web/src/WebApp.test.tsx`:

```tsx
it("lists and restores individual server memos from the shared DB", async () => {
  const user = userEvent.setup();
  vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
  vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
    callback(LOGGED_IN_USER);
    return vi.fn();
  });
  vi.mocked(listBackedUpMemos).mockResolvedValue([
    {
      memo: {
        id: "server-web-memo",
        title: "",
        plainText: "서버에서 가져온 웹 메모",
        richContent: { type: "doc", content: [{ type: "paragraph" }] },
        style: {
          backgroundColor: "#fff7b8",
          textColor: "#1f2937",
          fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
          fontSize: 16,
        },
        windowState: {
          x: null,
          y: null,
          width: 320,
          height: 280,
          visible: true,
          alwaysOnTop: false,
        },
        createdAt: "2026-05-17T09:00:00.000Z",
        updatedAt: "2026-05-17T09:05:00.000Z",
        deletedAt: null,
        syncState: "backed-up",
      },
      backupCreatedAt: "2026-05-17T09:06:00.000Z",
    },
  ]);

  render(<WebApp />);

  await user.click(screen.getByLabelText("앱 메뉴"));
  await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

  const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
  expect(within(dialog).getByText("서버에서 가져온 웹 메모")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "서버에서 가져온 웹 메모 복원" }));

  await waitFor(() => {
    expect(screen.getByDisplayValue("서버에서 가져온 웹 메모")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("서버 메모 복원 완료");
  });
});

it("removes deleted server memo cards after server delete succeeds", async () => {
  const user = userEvent.setup();
  vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
  vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
    callback(LOGGED_IN_USER);
    return vi.fn();
  });
  vi.mocked(listBackedUpMemos).mockResolvedValueOnce([
    {
      memo: {
        id: "server-delete-memo",
        title: "",
        plainText: "삭제할 서버 메모",
        richContent: { type: "doc", content: [{ type: "paragraph" }] },
        style: {
          backgroundColor: "#fff7b8",
          textColor: "#1f2937",
          fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
          fontSize: 16,
        },
        windowState: {
          x: null,
          y: null,
          width: 320,
          height: 280,
          visible: true,
          alwaysOnTop: false,
        },
        createdAt: "2026-05-17T09:00:00.000Z",
        updatedAt: "2026-05-17T09:05:00.000Z",
        deletedAt: null,
        syncState: "backed-up",
      },
      backupCreatedAt: "2026-05-17T09:06:00.000Z",
    },
  ]);
  vi.mocked(deleteBackedUpMemo).mockResolvedValue(1);

  render(<WebApp />);

  await user.click(screen.getByLabelText("앱 메뉴"));
  await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

  const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
  await user.click(within(dialog).getByRole("button", { name: "삭제할 서버 메모 서버 삭제" }));

  await waitFor(() => {
    expect(deleteBackedUpMemo).toHaveBeenCalledWith(expect.anything(), LOGGED_IN_USER.uid, "server-delete-memo");
    expect(within(dialog).queryByText("삭제할 서버 메모")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("서버 메모를 삭제했습니다.");
  });
});
```

Also update the import list in the test:

```tsx
import {
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  deleteBackedUpMemo,
  getFirebaseAuth,
  listBackedUpMemos,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
  waitForSignedInUser,
} from "@h-memo/memo-sync";
```

And the mock factory:

```tsx
deleteBackedUpMemo: vi.fn(),
listBackedUpMemos: vi.fn(),
```

In `beforeEach`, add:

```tsx
vi.mocked(deleteBackedUpMemo).mockResolvedValue(1);
vi.mocked(listBackedUpMemos).mockResolvedValue([]);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- apps/web/src/WebApp.test.tsx
```

Expected: FAIL because `서버 메모 관리` is not wired into the web app yet.

- [ ] **Step 3: Implement WebApp server memo manager state**

Modify imports in `apps/web/src/WebApp.tsx`:

```tsx
import { MemoWorkspace, ServerMemoManagerDialog } from "@h-memo/memo-ui";
import {
  FirestoreBackupGateway,
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  deleteBackedUpMemo,
  getFirebaseAuth,
  hasFirebaseConfig,
  listBackedUpMemos,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
  waitForSignedInUser,
  type BackedUpMemo,
  type HMemoUser,
} from "@h-memo/memo-sync";
```

Add state near the existing `useState` declarations:

```tsx
const [serverMemoManagerOpen, setServerMemoManagerOpen] = useState(false);
const [serverMemoItems, setServerMemoItems] = useState<BackedUpMemo[]>([]);
const [serverMemoStatus, setServerMemoStatus] = useState("서버 메모를 불러오지 않았습니다.");
```

Add helper and handlers before the final return:

```tsx
const requireServerSession = () => {
  const services = ensureSyncServices();
  if (!user || !services) {
    setBackupStatus(LOGIN_REQUIRED_MESSAGE);
    return null;
  }
  return { services, userId: user.uid };
};

const refreshServerMemos = async () => {
  const session = requireServerSession();
  if (!session) {
    return;
  }

  setIsBusy(true);
  setServerMemoStatus("서버 메모를 불러오는 중입니다.");
  try {
    const items = await listBackedUpMemos(session.services.gateway, session.userId);
    setServerMemoItems(items);
    setServerMemoStatus(
      items.length === 0
        ? "서버에 저장된 메모가 없습니다."
        : `서버 메모 ${items.length}개를 불러왔습니다.`
    );
  } catch (error) {
    setServerMemoStatus(`서버 메모 목록 불러오기 실패: ${getErrorMessage(error)}`);
    setBackupStatus(`서버 메모 목록 불러오기 실패: ${getErrorMessage(error)}`);
  } finally {
    setIsBusy(false);
  }
};

const handleOpenServerMemoManager = async () => {
  setServerMemoManagerOpen(true);
  await refreshServerMemos();
};

const handleRestoreServerMemo = async (memoId: string) => {
  const target = serverMemoItems.find((item) => item.memo.id === memoId);
  if (!target) {
    setServerMemoStatus("복원할 서버 메모를 찾지 못했습니다.");
    return;
  }

  setIsBusy(true);
  try {
    const restored = await repository.saveMemo({
      ...target.memo,
      deletedAt: null,
      syncState: "backed-up",
      windowState: {
        ...target.memo.windowState,
        visible: true,
      },
    });
    upsertMemo(restored);
    setBackupStatus("서버 메모 복원 완료");
    setServerMemoStatus("서버 메모 복원 완료");
  } catch (error) {
    setServerMemoStatus(`서버 메모 복원 실패: ${getErrorMessage(error)}`);
  } finally {
    setIsBusy(false);
  }
};

const handleDeleteServerMemo = async (memoId: string) => {
  const session = requireServerSession();
  if (!session) {
    return;
  }

  setIsBusy(true);
  try {
    await deleteBackedUpMemo(session.services.gateway, session.userId, memoId);
    setServerMemoItems((items) => items.filter((item) => item.memo.id !== memoId));
    setBackupStatus("서버 메모를 삭제했습니다.");
    setServerMemoStatus("서버 메모를 삭제했습니다.");
  } catch (error) {
    setServerMemoStatus(`서버 메모 삭제 실패: ${getErrorMessage(error)}`);
    setBackupStatus(`서버 메모 삭제 실패: ${getErrorMessage(error)}`);
  } finally {
    setIsBusy(false);
  }
};
```

Pass a web action into `MemoWorkspace`:

```tsx
actions={
  <button type="button" disabled={!isServerReady || user === null || isBusy} onClick={handleOpenServerMemoManager}>
    서버 메모 관리
  </button>
}
```

Render the dialog after the hidden JSON input:

```tsx
<ServerMemoManagerDialog
  isOpen={serverMemoManagerOpen}
  isBusy={isBusy}
  items={serverMemoItems}
  status={serverMemoStatus}
  onClose={() => setServerMemoManagerOpen(false)}
  onRefresh={refreshServerMemos}
  onRestore={handleRestoreServerMemo}
  onDelete={handleDeleteServerMemo}
/>
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- apps/web/src/WebApp.test.tsx packages/memo-ui/src/ServerMemoManagerDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/WebApp.tsx apps/web/src/WebApp.test.tsx packages/memo-ui/src/ServerMemoManagerDialog.tsx packages/memo-ui/src/ServerMemoManagerDialog.test.tsx packages/memo-ui/src/index.ts
git commit -m "feat: manage server memos in web app"
```

---

### Task 3: Promote Web Preview Copy To Production Web App

**Files:**
- Modify: `apps/web/src/WebApp.tsx`
- Modify: `apps/web/src/WebApp.test.tsx`
- Modify: `docs/web-roadmap.md`

- [ ] **Step 1: Write failing copy test**

Update the first test in `apps/web/src/WebApp.test.tsx` from:

```tsx
expect(screen.getByRole("heading", { name: "H Memo (웹 미리보기)" })).toBeInTheDocument();
```

to:

```tsx
expect(screen.getByRole("heading", { name: "H Memo" })).toBeInTheDocument();
expect(screen.queryByText("웹 미리보기")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- apps/web/src/WebApp.test.tsx
```

Expected: FAIL because the web title is still `H Memo (웹 미리보기)`.

- [ ] **Step 3: Update WebApp title**

Modify the `MemoWorkspace` props in `apps/web/src/WebApp.tsx`:

```tsx
<MemoWorkspace
  appClassName="web-app"
  title="H Memo"
  memos={visibleMemos}
```

- [ ] **Step 4: Update roadmap wording**

Modify `docs/web-roadmap.md`:

```markdown
# 웹앱 로드맵

## 현재 상태

- `apps/web`은 더 이상 단순 미리보기가 아니라 같은 Firebase DB를 사용하는 웹앱 MVP입니다.
- Google 로그인 후 Windows/macOS 앱과 동일한 `users/{uid}/backupSnapshots` 및 `users/{uid}/serverMemoDeletes` 경로를 사용합니다.
- 서버 메모 관리에서 DB에 저장된 메모를 확인하고, 필요한 메모를 복원하거나 서버 삭제할 수 있습니다.

## 남은 제한

- 이 MVP는 수동 백업/복원 기반 공유 모델입니다.
- 실시간 동기화는 `docs/cross-platform-sync-roadmap.md`의 `users/{uid}/memos/{memoId}` 모델로 별도 단계에서 구현합니다.
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- apps/web/src/WebApp.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/WebApp.tsx apps/web/src/WebApp.test.tsx docs/web-roadmap.md
git commit -m "chore: promote web preview to shared db web app"
```

---

### Task 4: Add GitHub Pages Web Deployment

**Files:**
- Create: `.github/workflows/web-pages.yml`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/manifest.test.ts`

- [ ] **Step 1: Write failing workflow/config tests**

Create `scripts/web-pages-workflow.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("web GitHub Pages workflow", () => {
  it("builds apps/web and uploads its dist folder to GitHub Pages", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "web-pages.yml"),
      "utf8"
    );

    expect(workflow).toContain("name: Web Pages Deploy");
    expect(workflow).toContain("npm run build -w apps/web");
    expect(workflow).toContain("path: apps/web/dist");
    expect(workflow).toContain("actions/deploy-pages");
  });
});
```

Add to `apps/web/src/manifest.test.ts`:

```ts
it("keeps relative PWA assets compatible with a GitHub Pages base path", async () => {
  const manifest = await readManifest();
  expect(manifest.start_url).toBe(".");
  expect(manifest.scope).toBe(".");
  expect(manifest.icons.every((icon) => !icon.src.startsWith("/"))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- scripts/web-pages-workflow.test.ts apps/web/src/manifest.test.ts
```

Expected: FAIL because `.github/workflows/web-pages.yml` does not exist.

- [ ] **Step 3: Add web Pages workflow**

Create `.github/workflows/web-pages.yml`:

```yaml
name: Web Pages Deploy

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    name: Build web app
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "22"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Run typecheck
        run: npm run typecheck

      - name: Build web app
        run: npm run build -w apps/web
        env:
          GITHUB_PAGES: "true"
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY || vars.VITE_FIREBASE_API_KEY || '' }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN || vars.VITE_FIREBASE_AUTH_DOMAIN || '' }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID || vars.VITE_FIREBASE_PROJECT_ID || '' }}
          VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID || vars.VITE_FIREBASE_APP_ID || '' }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET || vars.VITE_FIREBASE_STORAGE_BUCKET || '' }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID || vars.VITE_FIREBASE_MESSAGING_SENDER_ID || '' }}
          VITE_FIREBASE_MEASUREMENT_ID: ${{ secrets.VITE_FIREBASE_MEASUREMENT_ID || vars.VITE_FIREBASE_MEASUREMENT_ID || '' }}

      - name: Configure Pages
        uses: actions/configure-pages@v6

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: apps/web/dist

  deploy:
    name: Deploy web app
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 4: Add GitHub Pages base path**

Modify `apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/h-memo/" : "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test -- scripts/web-pages-workflow.test.ts apps/web/src/manifest.test.ts
npm run build -w apps/web
```

Expected: PASS and `apps/web/dist` is generated.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/web-pages.yml apps/web/vite.config.ts apps/web/src/manifest.test.ts scripts/web-pages-workflow.test.ts
git commit -m "ci: deploy web app to github pages"
```

---

### Task 5: Update Firebase Web Deployment Documentation

**Files:**
- Modify: `docs/firebase-setup.md`
- Modify: `README.md`

- [ ] **Step 1: Update Firebase setup guide**

Add this section to `docs/firebase-setup.md` after “구글 로그인 설정”:

```markdown
## 3.1) 웹앱 배포 도메인 허용

웹앱을 GitHub Pages에 배포하면 Firebase Authentication에서 배포 도메인을 허용해야 구글 로그인이 정상 동작합니다.

필수 확인:

- Firebase Console → Authentication → Settings → Authorized domains
- GitHub Pages 도메인 추가: `wbmaker2.github.io`
- 커스텀 도메인을 붙이면 해당 도메인도 추가
- 앱 URL 예시: `https://wbmaker2.github.io/h-memo/`

웹앱은 브라우저 Firebase Auth popup/redirect 흐름을 사용합니다. 데스크톱 앱의 `VITE_GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` Desktop OAuth 설정은 웹앱 빌드에 필요하지 않습니다.
```

- [ ] **Step 2: Update README web commands**

Add this section to `README.md`:

```markdown
## Web App

The web app lives in `apps/web` and uses the same Firebase Auth + Firestore backup DB as the desktop apps.

Local run:

```bash
npm install
npm run build -w apps/web
npm run dev -w apps/web
```

Shared DB paths:

- `users/{uid}/backupSnapshots/{snapshotId}`
- `users/{uid}/serverMemoDeletes/{memoId}`

The first shared web release uses explicit server backup/restore and server memo management. Realtime per-memo sync will be implemented later through the `users/{uid}/memos/{memoId}` model.
```

- [ ] **Step 3: Run docs-adjacent checks**

Run:

```bash
npm test -- scripts/check-firebase-env.test.ts scripts/firestore-rules-policy.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/firebase-setup.md README.md
git commit -m "docs: describe shared db web app setup"
```

---

### Task 6: Full Verification And PR

**Files:**
- No new source files. This task verifies the branch and opens a PR.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: all workspace typechecks pass.

- [ ] **Step 3: Build all workspaces**

```bash
npm run build
```

Expected: web and desktop build commands pass. If desktop Tauri build is not part of `npm run build`, document that this command validates TypeScript/Vite build surfaces only.

- [ ] **Step 4: Push branch**

```bash
git push -u origin codex/h-memo-shared-db-web-app
```

- [ ] **Step 5: Create PR**

```bash
gh pr create \
  --base main \
  --head codex/h-memo-shared-db-web-app \
  --title "Build shared DB web app" \
  --body "## Summary
- promote the web preview into a shared Firebase DB web app
- add server memo management for web
- add GitHub Pages deployment workflow
- document Firebase authorized domain setup

## Verification
- npm test
- npm run typecheck
- npm run build"
```

- [ ] **Step 6: Watch checks**

```bash
gh pr checks --watch
```

Expected: CI and web Pages workflow pass.

---

## Post-MVP Follow-Up

After this MVP is released and manually tested, create a separate implementation plan for true realtime sync:

- Move shared source of truth from `backupSnapshots` to `users/{uid}/memos/{memoId}`.
- Add `FirestoreMemoSyncGateway` in `packages/memo-sync`.
- Add desktop + web migration from latest backup snapshot to per-memo documents.
- Add Firestore rules for `users/{uid}/memos/{memoId}` and optional `windowStates/{deviceId}`.
- Keep legacy backup restore available until desktop and web both write the new model safely.

## Self-Review

- Spec coverage: The plan covers same DB usage, Google login, server backup/restore, server memo management, web deployment, and Firebase authorized domain setup.
- Placeholder scan: No `TBD`, `TODO`, or “implement later” placeholders are used in the actionable tasks.
- Type consistency: `BackedUpMemo`, `listBackedUpMemos`, `deleteBackedUpMemo`, `MemoWorkspace`, and `ServerMemoManagerDialog` names are used consistently.
- Scope check: Realtime sync is intentionally excluded from this MVP because current desktop releases still use `backupSnapshots`; it is captured as a post-MVP follow-up.
