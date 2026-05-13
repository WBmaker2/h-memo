# H Memo Windows MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Windows desktop MVP of H Memo: a Tauri 2 + React sticky memo app with system tray launch, local-first storage, text export, Google/Firebase backup foundations, and Windows packaging.

**Architecture:** Keep product logic in TypeScript packages and keep Tauri focused on platform capabilities. The desktop app consumes `memo-core`, `memo-ui`, and `memo-sync`; future web/PWA work can reuse these packages with a different storage adapter.

**Tech Stack:** TypeScript, React, Vite, Vitest, Testing Library, Tauri 2, Rust, SQLite, Firebase Auth, Cloud Firestore, npm workspaces.

---

## Scope Check

This plan implements the Windows MVP from the design spec:

- Included: monorepo foundation, reusable memo model, React sticky note UI, desktop shell, local persistence, tray behavior, startup registration, `.txt` export, Firebase backup module, Firestore rules, Windows build workflow, and release checklist.
- Excluded from this plan: actual `apps/web` implementation, mobile app packaging, real-time multi-device sync, attachments, OCR, reminders, store distribution, and end-to-end encryption.

The excluded items should become separate specs/plans after the desktop MVP is usable.

## File Structure Map

### Root

- Create `package.json`: npm workspace scripts and shared dev dependencies.
- Create `tsconfig.base.json`: shared strict TypeScript settings.
- Create `vitest.config.ts`: shared test config for packages and apps.
- Create `.gitignore`: Node, Rust, Tauri, local env, and build outputs.
- Create `.env.example`: safe Firebase client env variable names.
- Create `README.md`: local setup, development commands, Windows build notes.

### `packages/memo-core`

- Create `packages/memo-core/package.json`: package entrypoints.
- Create `packages/memo-core/src/types.ts`: memo, style, window, backup, repository types.
- Create `packages/memo-core/src/memoFactory.ts`: safe memo creation and update helpers.
- Create `packages/memo-core/src/richText.ts`: plain text extraction from Tiptap/ProseMirror-like JSON.
- Create `packages/memo-core/src/exportText.ts`: `.txt` export formatting.
- Create `packages/memo-core/src/backupPayload.ts`: backup payload creation and validation.
- Create `packages/memo-core/src/memoryRepository.ts`: test/dev in-memory repository.
- Create `packages/memo-core/src/index.ts`: public exports.
- Create `packages/memo-core/src/*.test.ts`: behavior tests.

### `packages/memo-ui`

- Create `packages/memo-ui/package.json`: UI package entrypoints and peer deps.
- Create `packages/memo-ui/src/StickyMemo.tsx`: sticky memo surface.
- Create `packages/memo-ui/src/MemoToolbar.tsx`: color/font/action controls.
- Create `packages/memo-ui/src/SettingsPanel.tsx`: login, backup, startup, export settings surface.
- Create `packages/memo-ui/src/theme.ts`: color/font options.
- Create `packages/memo-ui/src/index.ts`: public exports.
- Create `packages/memo-ui/src/*.test.tsx`: user-flow UI tests.

### `packages/memo-sync`

- Create `packages/memo-sync/package.json`: sync package entrypoints.
- Create `packages/memo-sync/src/firebaseConfig.ts`: reads Firebase client env.
- Create `packages/memo-sync/src/auth.ts`: Google sign-in abstraction.
- Create `packages/memo-sync/src/backup.ts`: backup/restore functions.
- Create `packages/memo-sync/src/index.ts`: public exports.
- Create `packages/memo-sync/src/backup.test.ts`: backup payload tests with fakes.

### `apps/desktop`

- Create `apps/desktop/package.json`: Vite, Tauri, desktop dependencies and scripts.
- Create `apps/desktop/index.html`: desktop root document.
- Create `apps/desktop/vite.config.ts`: React/Vitest config.
- Create `apps/desktop/tsconfig.json`: desktop TS config.
- Create `apps/desktop/src/main.tsx`: React entry.
- Create `apps/desktop/src/App.tsx`: desktop application state and wiring.
- Create `apps/desktop/src/App.test.tsx`: desktop app behavior tests.
- Create `apps/desktop/src/adapters/tauriMemoRepository.ts`: TypeScript bridge to Tauri commands.
- Create `apps/desktop/src/adapters/tauriPlatform.ts`: TypeScript bridge for export/startup/window actions.
- Create `apps/desktop/src/styles.css`: desktop memo styling.
- Create `apps/desktop/src-tauri/Cargo.toml`: Rust dependencies.
- Create `apps/desktop/src-tauri/tauri.conf.json`: Tauri app config, bundle target, permissions.
- Create `apps/desktop/src-tauri/src/main.rs`: Tauri process entry.
- Create `apps/desktop/src-tauri/src/lib.rs`: tray, memo storage commands, and native plugins.
- Create `apps/desktop/src-tauri/icons/icon.svg`: icon source used to generate installer/tray icons.
- Create `apps/desktop/src-tauri/capabilities/default.json`: Tauri permissions.

### Firebase and Release

- Create `firebase.json`: Firestore rules/test config.
- Create `firestore.rules`: per-user memo backup access rules.
- Create `.github/workflows/windows-build.yml`: Windows CI build artifact.
- Create `docs/release/windows-mvp-checklist.md`: manual smoke checklist.

---

## Task 1: Workspace Foundation

**Files:**

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Create root workspace metadata**

Create `package.json`:

```json
{
  "name": "h-memo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev -w apps/desktop",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "npm run typecheck -ws --if-present",
    "build": "npm run build -ws --if-present",
    "tauri:dev": "npm run tauri:dev -w apps/desktop",
    "tauri:build": "npm run tauri:build -w apps/desktop"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create shared TypeScript and test config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  }
}
```

Create `vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true
  }
});
```

- [ ] **Step 3: Create git ignore rules**

Create `.gitignore`:

```gitignore
node_modules/
dist/
dist-ssr/
coverage/
.env
.env.local
.DS_Store
*.log
target/
src-tauri/target/
apps/desktop/src-tauri/target/
apps/desktop/src-tauri/gen/
apps/desktop/src-tauri/.tauri/
```

- [ ] **Step 4: Create safe env example**

Create `.env.example`:

```dotenv
VITE_FIREBASE_API_KEY=replace-with-client-api-key
VITE_FIREBASE_AUTH_DOMAIN=replace-with-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=replace-with-project-id
VITE_FIREBASE_APP_ID=replace-with-web-app-id
```

- [ ] **Step 5: Create README**

Create `README.md`:

```markdown
# H Memo

H Memo is a local-first sticky memo app. The first target is a Windows desktop app built with Tauri 2, React, and TypeScript. Shared memo logic lives in packages so a future web/PWA version can reuse the same model and UI.

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Desktop

```bash
npm run tauri:dev
npm run tauri:build
```

Windows installer artifacts are produced through the Tauri bundle step. Final Windows smoke testing must happen on Windows or a Windows CI runner.
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and dependencies install successfully.

- [ ] **Step 7: Commit foundation**

Run:

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts .gitignore .env.example README.md
git commit -m "chore: initialize h memo workspace"
```

Expected: commit succeeds.

---

## Task 2: `memo-core` Domain Package

**Files:**

- Create: `packages/memo-core/package.json`
- Create: `packages/memo-core/tsconfig.json`
- Create: `packages/memo-core/src/types.ts`
- Create: `packages/memo-core/src/memoFactory.ts`
- Create: `packages/memo-core/src/richText.ts`
- Create: `packages/memo-core/src/exportText.ts`
- Create: `packages/memo-core/src/backupPayload.ts`
- Create: `packages/memo-core/src/memoryRepository.ts`
- Create: `packages/memo-core/src/index.ts`
- Test: `packages/memo-core/src/memoFactory.test.ts`
- Test: `packages/memo-core/src/richText.test.ts`
- Test: `packages/memo-core/src/exportText.test.ts`
- Test: `packages/memo-core/src/backupPayload.test.ts`

- [ ] **Step 1: Create package metadata**

Create `packages/memo-core/package.json`:

```json
{
  "name": "@h-memo/memo-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `packages/memo-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 2: Write failing domain tests**

Create `packages/memo-core/src/memoFactory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemo, renameMemo, updateMemoStyle, softDeleteMemo } from "./memoFactory";

describe("memoFactory", () => {
  it("creates a safe default memo", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });

    expect(memo.id).toBe("memo-1");
    expect(memo.title).toBe("새 메모");
    expect(memo.plainText).toBe("");
    expect(memo.style.backgroundColor).toBe("#fff7b8");
    expect(memo.windowState.visible).toBe(true);
    expect(memo.syncState).toBe("local-only");
  });

  it("renames and marks the memo as queued", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const updated = renameMemo(memo, "회의 메모", "2026-05-13T09:01:00.000Z");

    expect(updated.title).toBe("회의 메모");
    expect(updated.updatedAt).toBe("2026-05-13T09:01:00.000Z");
    expect(updated.syncState).toBe("queued");
  });

  it("updates style without mutating the original memo", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const updated = updateMemoStyle(memo, { textColor: "#111111", fontSize: 20 }, "2026-05-13T09:02:00.000Z");

    expect(memo.style.textColor).toBe("#1f2937");
    expect(updated.style.textColor).toBe("#111111");
    expect(updated.style.fontSize).toBe(20);
  });

  it("soft deletes memo instead of removing it", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const deleted = softDeleteMemo(memo, "2026-05-13T09:03:00.000Z");

    expect(deleted.deletedAt).toBe("2026-05-13T09:03:00.000Z");
    expect(deleted.windowState.visible).toBe(false);
  });
});
```

Create `packages/memo-core/src/richText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractPlainText } from "./richText";

describe("extractPlainText", () => {
  it("extracts text from ProseMirror-like JSON", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "첫 줄" }] },
        { type: "paragraph", content: [{ type: "text", text: "둘째 줄" }] }
      ]
    };

    expect(extractPlainText(content)).toBe("첫 줄\n둘째 줄");
  });

  it("returns empty text for invalid rich content", () => {
    expect(extractPlainText(null)).toBe("");
    expect(extractPlainText("plain")).toBe("");
  });
});
```

Create `packages/memo-core/src/exportText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemo } from "./memoFactory";
import { formatMemoAsText, formatMemosAsCombinedText } from "./exportText";

describe("text export", () => {
  it("formats one memo as text", () => {
    const memo = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      title: "수업 준비",
      plainText: "준비물 확인"
    };

    expect(formatMemoAsText(memo)).toContain("제목: 수업 준비");
    expect(formatMemoAsText(memo)).toContain("준비물 확인");
  });

  it("combines visible memos and skips deleted memos", () => {
    const visible = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      title: "보이는 메모",
      plainText: "내용"
    };
    const deleted = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-2" }),
      title: "삭제된 메모",
      deletedAt: "2026-05-13T09:02:00.000Z"
    };

    const text = formatMemosAsCombinedText([visible, deleted]);

    expect(text).toContain("보이는 메모");
    expect(text).not.toContain("삭제된 메모");
  });
});
```

Create `packages/memo-core/src/backupPayload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemo } from "./memoFactory";
import { createBackupPayload, validateBackupPayload } from "./backupPayload";

describe("backupPayload", () => {
  it("creates a versioned backup payload", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const payload = createBackupPayload({
      userId: "user-1",
      memos: [memo],
      createdAt: "2026-05-13T09:05:00.000Z"
    });

    expect(payload.version).toBe(1);
    expect(payload.userId).toBe("user-1");
    expect(payload.memos).toHaveLength(1);
  });

  it("rejects payloads for the wrong user", () => {
    const payload = createBackupPayload({
      userId: "user-1",
      memos: [createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" })],
      createdAt: "2026-05-13T09:05:00.000Z"
    });

    expect(validateBackupPayload(payload, "user-2").ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- packages/memo-core/src
```

Expected: FAIL because source modules are missing.

- [ ] **Step 4: Implement domain types and helpers**

Create `packages/memo-core/src/types.ts`:

```ts
export type SyncState = "local-only" | "queued" | "backed-up" | "conflict";

export type MemoStyle = {
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
};

export type MemoWindowState = {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  visible: boolean;
  alwaysOnTop: boolean;
};

export type Memo = {
  id: string;
  title: string;
  plainText: string;
  richContent: unknown;
  style: MemoStyle;
  windowState: MemoWindowState;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncState: SyncState;
};

export type MemoRepository = {
  listMemos(): Promise<Memo[]>;
  saveMemo(memo: Memo): Promise<Memo>;
  softDeleteMemo(id: string, deletedAt: string): Promise<Memo>;
  restoreMemo(id: string, restoredAt: string): Promise<Memo>;
};

export type BackupPayload = {
  version: 1;
  userId: string;
  createdAt: string;
  memos: Memo[];
};

export type ValidationResult =
  | { ok: true; payload: BackupPayload }
  | { ok: false; reason: string };
```

Create `packages/memo-core/src/memoFactory.ts`:

```ts
import type { Memo, MemoStyle, MemoWindowState } from "./types";

const DEFAULT_STYLE: MemoStyle = {
  backgroundColor: "#fff7b8",
  textColor: "#1f2937",
  fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
  fontSize: 16
};

const DEFAULT_WINDOW_STATE: MemoWindowState = {
  x: null,
  y: null,
  width: 320,
  height: 280,
  visible: true,
  alwaysOnTop: false
};

export function createMemo({ now, id }: { now: string; id: string }): Memo {
  return {
    id,
    title: "새 메모",
    plainText: "",
    richContent: { type: "doc", content: [{ type: "paragraph" }] },
    style: DEFAULT_STYLE,
    windowState: DEFAULT_WINDOW_STATE,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: "local-only"
  };
}

export function renameMemo(memo: Memo, title: string, updatedAt: string): Memo {
  return {
    ...memo,
    title: title.trim() || "새 메모",
    updatedAt,
    syncState: "queued"
  };
}

export function updateMemoStyle(memo: Memo, style: Partial<MemoStyle>, updatedAt: string): Memo {
  return {
    ...memo,
    style: { ...memo.style, ...style },
    updatedAt,
    syncState: "queued"
  };
}

export function updateMemoContent(
  memo: Memo,
  richContent: unknown,
  plainText: string,
  updatedAt: string
): Memo {
  return {
    ...memo,
    richContent,
    plainText,
    updatedAt,
    syncState: "queued"
  };
}

export function updateMemoWindowState(
  memo: Memo,
  windowState: Partial<MemoWindowState>,
  updatedAt: string
): Memo {
  return {
    ...memo,
    windowState: { ...memo.windowState, ...windowState },
    updatedAt,
    syncState: "queued"
  };
}

export function softDeleteMemo(memo: Memo, deletedAt: string): Memo {
  return {
    ...memo,
    deletedAt,
    updatedAt: deletedAt,
    windowState: { ...memo.windowState, visible: false },
    syncState: "queued"
  };
}
```

Create `packages/memo-core/src/richText.ts`:

```ts
type RichNode = {
  type?: string;
  text?: string;
  content?: RichNode[];
};

function isRichNode(value: unknown): value is RichNode {
  return Boolean(value) && typeof value === "object";
}

function collectText(node: RichNode, lines: string[]): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  const childText = Array.isArray(node.content)
    ? node.content.map((child) => collectText(child, lines)).join("")
    : "";

  if (node.type === "paragraph" && childText) {
    lines.push(childText);
    return "";
  }

  return childText;
}

export function extractPlainText(content: unknown): string {
  if (!isRichNode(content)) {
    return "";
  }

  const lines: string[] = [];
  const rootText = collectText(content, lines);

  if (rootText) {
    lines.push(rootText);
  }

  return lines.join("\n").trim();
}
```

Create `packages/memo-core/src/exportText.ts`:

```ts
import type { Memo } from "./types";

export function formatMemoAsText(memo: Memo): string {
  return [
    `제목: ${memo.title}`,
    `수정: ${memo.updatedAt}`,
    "",
    memo.plainText
  ].join("\n");
}

export function formatMemosAsCombinedText(memos: Memo[]): string {
  return memos
    .filter((memo) => memo.deletedAt === null)
    .map(formatMemoAsText)
    .join("\n\n---\n\n");
}
```

Create `packages/memo-core/src/backupPayload.ts`:

```ts
import type { BackupPayload, Memo, ValidationResult } from "./types";

export function createBackupPayload({
  userId,
  memos,
  createdAt
}: {
  userId: string;
  memos: Memo[];
  createdAt: string;
}): BackupPayload {
  return {
    version: 1,
    userId,
    createdAt,
    memos
  };
}

export function validateBackupPayload(value: unknown, expectedUserId: string): ValidationResult {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "백업 데이터가 객체가 아닙니다." };
  }

  const payload = value as BackupPayload;

  if (payload.version !== 1) {
    return { ok: false, reason: "지원하지 않는 백업 버전입니다." };
  }

  if (payload.userId !== expectedUserId) {
    return { ok: false, reason: "다른 사용자의 백업 데이터입니다." };
  }

  if (!Array.isArray(payload.memos)) {
    return { ok: false, reason: "메모 목록이 없습니다." };
  }

  for (const memo of payload.memos) {
    if (!memo || typeof memo.id !== "string" || typeof memo.title !== "string") {
      return { ok: false, reason: "잘못된 메모 데이터가 포함되어 있습니다." };
    }
  }

  return { ok: true, payload };
}
```

Create `packages/memo-core/src/memoryRepository.ts`:

```ts
import type { Memo, MemoRepository } from "./types";

export class MemoryMemoRepository implements MemoRepository {
  private memos = new Map<string, Memo>();

  constructor(initialMemos: Memo[] = []) {
    initialMemos.forEach((memo) => this.memos.set(memo.id, memo));
  }

  async listMemos(): Promise<Memo[]> {
    return Array.from(this.memos.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    this.memos.set(memo.id, memo);
    return memo;
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    const memo = this.memos.get(id);
    if (!memo) {
      throw new Error(`Memo not found: ${id}`);
    }
    const deleted = {
      ...memo,
      deletedAt,
      updatedAt: deletedAt,
      windowState: { ...memo.windowState, visible: false },
      syncState: "queued" as const
    };
    this.memos.set(id, deleted);
    return deleted;
  }

  async restoreMemo(id: string, restoredAt: string): Promise<Memo> {
    const memo = this.memos.get(id);
    if (!memo) {
      throw new Error(`Memo not found: ${id}`);
    }
    const restored = {
      ...memo,
      deletedAt: null,
      updatedAt: restoredAt,
      windowState: { ...memo.windowState, visible: true },
      syncState: "queued" as const
    };
    this.memos.set(id, restored);
    return restored;
  }
}
```

Create `packages/memo-core/src/index.ts`:

```ts
export * from "./backupPayload";
export * from "./exportText";
export * from "./memoFactory";
export * from "./memoryRepository";
export * from "./richText";
export * from "./types";
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test -- packages/memo-core/src
npm run typecheck
```

Expected: PASS for memo-core tests and typecheck.

- [ ] **Step 6: Commit memo-core**

Run:

```bash
git add packages/memo-core
git commit -m "feat: add memo core domain model"
```

Expected: commit succeeds.

---

## Task 3: `memo-ui` React Components

**Files:**

- Create: `packages/memo-ui/package.json`
- Create: `packages/memo-ui/tsconfig.json`
- Create: `packages/memo-ui/src/theme.ts`
- Create: `packages/memo-ui/src/MemoToolbar.tsx`
- Create: `packages/memo-ui/src/StickyMemo.tsx`
- Create: `packages/memo-ui/src/SettingsPanel.tsx`
- Create: `packages/memo-ui/src/index.ts`
- Test: `packages/memo-ui/src/StickyMemo.test.tsx`
- Test: `packages/memo-ui/src/SettingsPanel.test.tsx`

- [ ] **Step 1: Create UI package metadata**

Create `packages/memo-ui/package.json`:

```json
{
  "name": "@h-memo/memo-ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "peerDependencies": {
    "@h-memo/memo-core": "0.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `packages/memo-ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 2: Write failing UI tests**

Create `packages/memo-ui/src/StickyMemo.test.tsx`:

```tsx
import { createMemo } from "@h-memo/memo-core";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StickyMemo } from "./StickyMemo";

describe("StickyMemo", () => {
  it("edits title, body, and style", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onChange = vi.fn();

    render(<StickyMemo memo={memo} onChange={onChange} onHide={vi.fn()} onDelete={vi.fn()} />);

    await user.clear(screen.getByLabelText("메모 제목"));
    await user.type(screen.getByLabelText("메모 제목"), "오늘 할 일");
    await user.type(screen.getByLabelText("메모 내용"), "자료 정리");
    await user.click(screen.getByRole("button", { name: "노란색 배경" }));

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByDisplayValue("오늘 할 일")).toBeInTheDocument();
  });

  it("requests hide and delete through icon buttons", async () => {
    const user = userEvent.setup();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const onHide = vi.fn();
    const onDelete = vi.fn();

    render(<StickyMemo memo={memo} onChange={vi.fn()} onHide={onHide} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));
    await user.click(screen.getByRole("button", { name: "메모 삭제" }));

    expect(onHide).toHaveBeenCalledWith("memo-1");
    expect(onDelete).toHaveBeenCalledWith("memo-1");
  });
});
```

Create `packages/memo-ui/src/SettingsPanel.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("shows backup state and calls platform actions", async () => {
    const user = userEvent.setup();
    const onBackup = vi.fn();
    const onExportText = vi.fn();
    const onToggleStartup = vi.fn();

    render(
      <SettingsPanel
        userName="홍길동"
        backupStatus="마지막 백업: 2026-05-13 18:00"
        startupEnabled={false}
        onBackup={onBackup}
        onRestore={vi.fn()}
        onExportText={onExportText}
        onToggleStartup={onToggleStartup}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "서버 백업" }));
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    await user.click(screen.getByRole("switch", { name: "시작프로그램 등록" }));

    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(onBackup).toHaveBeenCalled();
    expect(onExportText).toHaveBeenCalled();
    expect(onToggleStartup).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- packages/memo-ui/src
```

Expected: FAIL because UI components are missing.

- [ ] **Step 4: Implement UI components**

Create `packages/memo-ui/src/theme.ts`:

```ts
export const memoBackgrounds = [
  { label: "노란색 배경", value: "#fff7b8" },
  { label: "초록색 배경", value: "#d9f99d" },
  { label: "파란색 배경", value: "#bfdbfe" },
  { label: "분홍색 배경", value: "#fecdd3" },
  { label: "흰색 배경", value: "#ffffff" }
];

export const textColors = [
  { label: "검정 글자", value: "#1f2937" },
  { label: "빨강 글자", value: "#b91c1c" },
  { label: "파랑 글자", value: "#1d4ed8" },
  { label: "초록 글자", value: "#047857" }
];

export const fontFamilies = [
  "Malgun Gothic, Segoe UI, sans-serif",
  "Segoe UI, sans-serif",
  "Georgia, serif",
  "Consolas, monospace"
];
```

Create `packages/memo-ui/src/MemoToolbar.tsx`:

```tsx
import type { MemoStyle } from "@h-memo/memo-core";
import { fontFamilies, memoBackgrounds, textColors } from "./theme";

type Props = {
  style: MemoStyle;
  onStyleChange: (style: Partial<MemoStyle>) => void;
  onHide: () => void;
  onDelete: () => void;
};

export function MemoToolbar({ style, onStyleChange, onHide, onDelete }: Props) {
  return (
    <div className="memo-toolbar" aria-label="메모 도구">
      <div className="swatch-row" aria-label="배경색">
        {memoBackgrounds.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            className="swatch-button"
            style={{ backgroundColor: option.value }}
            data-selected={style.backgroundColor === option.value}
            onClick={() => onStyleChange({ backgroundColor: option.value })}
          />
        ))}
      </div>

      <label>
        글꼴
        <select value={style.fontFamily} onChange={(event) => onStyleChange({ fontFamily: event.target.value })}>
          {fontFamilies.map((font) => (
            <option key={font} value={font}>
              {font.split(",")[0]}
            </option>
          ))}
        </select>
      </label>

      <label>
        크기
        <input
          aria-label="글자 크기"
          type="number"
          min={12}
          max={36}
          value={style.fontSize}
          onChange={(event) => onStyleChange({ fontSize: Number(event.target.value) })}
        />
      </label>

      <div className="swatch-row" aria-label="글자색">
        {textColors.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            className="swatch-button"
            style={{ backgroundColor: option.value }}
            data-selected={style.textColor === option.value}
            onClick={() => onStyleChange({ textColor: option.value })}
          />
        ))}
      </div>

      <button type="button" aria-label="메모 숨기기" onClick={onHide}>
        숨김
      </button>
      <button type="button" aria-label="메모 삭제" onClick={onDelete}>
        삭제
      </button>
    </div>
  );
}
```

Create `packages/memo-ui/src/StickyMemo.tsx`:

```tsx
import { extractPlainText, type Memo, updateMemoContent, updateMemoStyle, renameMemo } from "@h-memo/memo-core";
import { MemoToolbar } from "./MemoToolbar";

type Props = {
  memo: Memo;
  onChange: (memo: Memo) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
};

function nowIso() {
  return new Date().toISOString();
}

export function StickyMemo({ memo, onChange, onHide, onDelete }: Props) {
  return (
    <article
      className="sticky-memo"
      style={{
        backgroundColor: memo.style.backgroundColor,
        color: memo.style.textColor,
        fontFamily: memo.style.fontFamily,
        fontSize: memo.style.fontSize
      }}
    >
      <input
        aria-label="메모 제목"
        className="memo-title"
        value={memo.title}
        onChange={(event) => onChange(renameMemo(memo, event.target.value, nowIso()))}
      />
      <textarea
        aria-label="메모 내용"
        className="memo-body"
        value={memo.plainText}
        onChange={(event) => {
          const richContent = {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: event.target.value }] }]
          };
          onChange(updateMemoContent(memo, richContent, extractPlainText(richContent), nowIso()));
        }}
      />
      <MemoToolbar
        style={memo.style}
        onStyleChange={(style) => onChange(updateMemoStyle(memo, style, nowIso()))}
        onHide={() => onHide(memo.id)}
        onDelete={() => onDelete(memo.id)}
      />
    </article>
  );
}
```

Create `packages/memo-ui/src/SettingsPanel.tsx`:

```tsx
type Props = {
  userName: string | null;
  backupStatus: string;
  startupEnabled: boolean;
  onBackup: () => void;
  onRestore: () => void;
  onExportText: () => void;
  onToggleStartup: (enabled: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
};

export function SettingsPanel({
  userName,
  backupStatus,
  startupEnabled,
  onBackup,
  onRestore,
  onExportText,
  onToggleStartup,
  onSignIn,
  onSignOut
}: Props) {
  return (
    <section className="settings-panel" aria-label="설정">
      <div>
        <strong>로그인</strong>
        {userName ? (
          <p>
            <span>{userName}</span>
            <button type="button" onClick={onSignOut}>
              로그아웃
            </button>
          </p>
        ) : (
          <button type="button" onClick={onSignIn}>
            Google 로그인
          </button>
        )}
      </div>

      <p role="status">{backupStatus}</p>

      <button type="button" onClick={onBackup}>
        서버 백업
      </button>
      <button type="button" onClick={onRestore}>
        서버 복원
      </button>
      <button type="button" onClick={onExportText}>
        TXT 내보내기
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={startupEnabled}
        aria-label="시작프로그램 등록"
        onClick={() => onToggleStartup(!startupEnabled)}
      >
        시작프로그램 {startupEnabled ? "켜짐" : "꺼짐"}
      </button>
    </section>
  );
}
```

Create `packages/memo-ui/src/index.ts`:

```ts
export * from "./MemoToolbar";
export * from "./SettingsPanel";
export * from "./StickyMemo";
export * from "./theme";
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
npm test -- packages/memo-ui/src
npm run typecheck
```

Expected: PASS for UI tests and typecheck.

- [ ] **Step 6: Commit memo-ui**

Run:

```bash
git add packages/memo-ui
git commit -m "feat: add reusable memo ui"
```

Expected: commit succeeds.

---

## Task 4: Desktop React App with Memory Repository

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/styles.css`
- Test: `apps/desktop/src/App.test.tsx`

- [ ] **Step 1: Create desktop package and config**

Create `apps/desktop/package.json`:

```json
{
  "name": "@h-memo/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "tauri:icon": "tauri icon src-tauri/icons/icon.svg"
  },
  "dependencies": {
    "@h-memo/memo-core": "0.1.0",
    "@h-memo/memo-ui": "0.1.0",
    "@tauri-apps/api": "^2.2.0",
    "@tauri-apps/plugin-autostart": "^2.2.0",
    "@tauri-apps/plugin-dialog": "^2.2.0",
    "@tauri-apps/plugin-fs": "^2.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.2.0"
  }
}
```

Create `apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `apps/desktop/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  clearScreen: false,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: []
  }
});
```

Create `apps/desktop/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>H Memo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Refresh workspace dependencies**

Run:

```bash
npm install
```

Expected: npm links `@h-memo/desktop`, `@h-memo/memo-core`, and `@h-memo/memo-ui` workspaces and installs React/Tauri dependencies.

- [ ] **Step 3: Write failing app test**

Create `apps/desktop/src/App.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("desktop App", () => {
  it("creates a memo, edits it, and exports text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    await user.clear(screen.getByLabelText("메모 제목"));
    await user.type(screen.getByLabelText("메모 제목"), "윈도우 메모");
    await user.type(screen.getByLabelText("메모 내용"), "트레이에서 열리는 메모");
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    expect(screen.getByText(/제목: 윈도우 메모/)).toBeInTheDocument();
    expect(screen.getByText(/트레이에서 열리는 메모/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run app test and verify failure**

Run:

```bash
npm test -- apps/desktop/src/App.test.tsx
```

Expected: FAIL because `App` is missing.

- [ ] **Step 5: Implement desktop React app**

Create `apps/desktop/src/App.tsx`:

```tsx
import { createMemo, formatMemosAsCombinedText, MemoryMemoRepository, type Memo } from "@h-memo/memo-core";
import { SettingsPanel, StickyMemo } from "@h-memo/memo-ui";
import { useEffect, useMemo, useState } from "react";

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

export function App() {
  const repository = useMemo(() => new MemoryMemoRepository(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [txtPreview, setTxtPreview] = useState("");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [backupStatus, setBackupStatus] = useState("아직 백업하지 않았습니다.");

  useEffect(() => {
    repository.listMemos().then(setMemos);
  }, [repository]);

  async function refresh() {
    setMemos(await repository.listMemos());
  }

  async function createNewMemo() {
    await repository.saveMemo(createMemo({ now: nowIso(), id: newId() }));
    await refresh();
  }

  async function saveMemo(memo: Memo) {
    await repository.saveMemo(memo);
    await refresh();
  }

  async function hideMemo(id: string) {
    const memo = memos.find((item) => item.id === id);
    if (!memo) return;
    await repository.saveMemo({
      ...memo,
      windowState: { ...memo.windowState, visible: false },
      updatedAt: nowIso(),
      syncState: "queued"
    });
    await refresh();
  }

  async function deleteMemo(id: string) {
    await repository.softDeleteMemo(id, nowIso());
    await refresh();
  }

  const visibleMemos = memos.filter((memo) => memo.deletedAt === null && memo.windowState.visible);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>H Memo</h1>
        <button type="button" onClick={createNewMemo}>
          새 메모
        </button>
        <button type="button" onClick={() => setTxtPreview(formatMemosAsCombinedText(memos))}>
          TXT 미리보기
        </button>
      </header>

      <section className="memo-board" aria-label="메모 목록">
        {visibleMemos.length === 0 ? <p>트레이에서 열 새 메모를 만들어보세요.</p> : null}
        {visibleMemos.map((memo) => (
          <StickyMemo key={memo.id} memo={memo} onChange={saveMemo} onHide={hideMemo} onDelete={deleteMemo} />
        ))}
      </section>

      <SettingsPanel
        userName={null}
        backupStatus={backupStatus}
        startupEnabled={startupEnabled}
        onBackup={() => setBackupStatus(`로컬 백업 준비됨: ${new Date().toLocaleString("ko-KR")}`)}
        onRestore={() => setBackupStatus("복원할 서버 백업을 선택해야 합니다.")}
        onExportText={() => setTxtPreview(formatMemosAsCombinedText(memos))}
        onToggleStartup={setStartupEnabled}
        onSignIn={() => setBackupStatus("Google 로그인은 Tauri 셸 연결 후 활성화됩니다.")}
        onSignOut={() => setBackupStatus("로그아웃 상태입니다.")}
      />

      {txtPreview ? (
        <pre className="txt-preview" aria-label="TXT 미리보기 결과">
          {txtPreview}
        </pre>
      ) : null}
    </main>
  );
}
```

Create `apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `apps/desktop/src/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Malgun Gothic", "Segoe UI", sans-serif;
  background: #f3f4f6;
  color: #111827;
}

button,
input,
select,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  padding: 16px;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.app-header h1 {
  margin: 0 auto 0 0;
  font-size: 20px;
}

.memo-board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: start;
}

.sticky-memo {
  min-height: 260px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 8px;
  box-shadow: 0 16px 30px rgba(17, 24, 39, 0.12);
  padding: 12px;
}

.memo-title,
.memo-body {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
}

.memo-title {
  font-weight: 700;
  margin-bottom: 8px;
}

.memo-body {
  min-height: 120px;
  resize: vertical;
}

.memo-toolbar,
.settings-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.swatch-row {
  display: flex;
  gap: 4px;
}

.swatch-button {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(17, 24, 39, 0.2);
  border-radius: 999px;
}

.swatch-button[data-selected="true"] {
  outline: 2px solid #111827;
  outline-offset: 2px;
}

.settings-panel {
  margin-top: 20px;
  padding: 12px 0;
  border-top: 1px solid #d1d5db;
}

.txt-preview {
  margin-top: 16px;
  padding: 12px;
  background: #111827;
  color: #f9fafb;
  border-radius: 8px;
  white-space: pre-wrap;
}
```

- [ ] **Step 6: Run app tests and local build**

Run:

```bash
npm test -- apps/desktop/src/App.test.tsx
npm run build -w apps/desktop
```

Expected: PASS for app test and desktop web build.

- [ ] **Step 7: Commit desktop React app**

Run:

```bash
git add apps/desktop package-lock.json
git commit -m "feat: add desktop memo app shell"
```

Expected: commit succeeds.

---

## Task 5: Tauri Shell, Tray, Storage, Export, Startup

**Files:**

- Create: `apps/desktop/src/adapters/tauriMemoRepository.ts`
- Create: `apps/desktop/src/adapters/tauriPlatform.ts`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/icons/icon.svg`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Create Tauri config**

Create `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "H Memo",
  "version": "0.1.0",
  "identifier": "com.hmemo.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://127.0.0.1:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "H Memo",
        "width": 380,
        "height": 420,
        "resizable": true,
        "decorations": false,
        "visible": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ]
  }
}
```

Create `apps/desktop/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default H Memo desktop permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "autostart:default",
    "dialog:default",
    "fs:allow-write-text-file"
  ]
}
```

Create `apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "h-memo-desktop"
version = "0.1.0"
description = "H Memo desktop app"
authors = ["H Memo"]
edition = "2021"

[lib]
name = "h_memo_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
anyhow = "1"
chrono = { version = "0.4", features = ["serde"] }
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-autostart = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-opener = "2"
```

- [ ] **Step 2: Create icon source and generate Tauri icons**

Create `apps/desktop/src-tauri/icons/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#facc15"/>
  <path d="M120 120h272v272H120z" fill="#fff7b8"/>
  <path d="M152 168h208" stroke="#111827" stroke-width="24" stroke-linecap="round"/>
  <path d="M152 232h176" stroke="#111827" stroke-width="24" stroke-linecap="round"/>
  <path d="M152 296h128" stroke="#111827" stroke-width="24" stroke-linecap="round"/>
</svg>
```

Run:

```bash
npm run tauri:icon -w apps/desktop
```

Expected: Tauri generates `32x32.png`, `128x128.png`, `icon.ico`, and related icon assets under `apps/desktop/src-tauri/icons/`.

- [ ] **Step 3: Implement Rust entry**

Create `apps/desktop/src-tauri/src/main.rs`:

```rust
fn main() {
    h_memo_desktop_lib::run();
}
```

Create `apps/desktop/src-tauri/src/lib.rs`:

```rust
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MemoRecord {
    id: String,
    title: String,
    plain_text: String,
    rich_content: serde_json::Value,
    style: serde_json::Value,
    window_state: serde_json::Value,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    sync_state: String
}

fn db_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("h-memo.sqlite3"))
}

fn open_db(app: &AppHandle) -> anyhow::Result<Connection> {
    let conn = Connection::open(db_path(app)?)?;
    conn.execute(
        "create table if not exists memos (
            id text primary key,
            title text not null,
            plain_text text not null,
            rich_content text not null,
            style text not null,
            window_state text not null,
            created_at text not null,
            updated_at text not null,
            deleted_at text,
            sync_state text not null
        )",
        []
    )?;
    Ok(conn)
}

#[tauri::command]
fn list_memos(app: AppHandle) -> Result<Vec<MemoRecord>, String> {
    let conn = open_db(&app).map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare(
            "select id, title, plain_text, rich_content, style, window_state, created_at, updated_at, deleted_at, sync_state
             from memos
             order by updated_at desc"
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(MemoRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                plain_text: row.get(2)?,
                rich_content: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(3)?).unwrap_or_default(),
                style: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(4)?).unwrap_or_default(),
                window_state: serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(5)?).unwrap_or_default(),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                deleted_at: row.get(8)?,
                sync_state: row.get(9)?
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_memo(app: AppHandle, memo: MemoRecord) -> Result<MemoRecord, String> {
    let conn = open_db(&app).map_err(|error| error.to_string())?;
    conn.execute(
        "insert into memos (id, title, plain_text, rich_content, style, window_state, created_at, updated_at, deleted_at, sync_state)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         on conflict(id) do update set
           title=excluded.title,
           plain_text=excluded.plain_text,
           rich_content=excluded.rich_content,
           style=excluded.style,
           window_state=excluded.window_state,
           updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at,
           sync_state=excluded.sync_state",
        params![
            memo.id,
            memo.title,
            memo.plain_text,
            memo.rich_content.to_string(),
            memo.style.to_string(),
            memo.window_state.to_string(),
            memo.created_at,
            memo.updated_at,
            memo.deleted_at,
            memo.sync_state
        ]
    ).map_err(|error| error.to_string())?;
    Ok(memo)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "메모 열기", true, None::<&str>)?;
            let new_item = MenuItem::with_id(app, "new", "새 메모", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &new_item, &quit_item])?;
            let app_handle = app.handle().clone();

            TrayIconBuilder::with_id("main-tray")
                .tooltip("H Memo")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" | "new" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            show_main_window(&app_handle);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_memos,
            save_memo
        ])
        .run(tauri::generate_context!())
        .expect("failed to run H Memo");
}
```

- [ ] **Step 4: Implement TypeScript Tauri adapters**

Create `apps/desktop/src/adapters/tauriMemoRepository.ts`:

```ts
import type { Memo, MemoRepository } from "@h-memo/memo-core";
import { invoke } from "@tauri-apps/api/core";

export class TauriMemoRepository implements MemoRepository {
  async listMemos(): Promise<Memo[]> {
    return invoke<Memo[]>("list_memos");
  }

  async saveMemo(memo: Memo): Promise<Memo> {
    return invoke<Memo>("save_memo", { memo });
  }

  async softDeleteMemo(id: string, deletedAt: string): Promise<Memo> {
    const memos = await this.listMemos();
    const memo = memos.find((item) => item.id === id);
    if (!memo) {
      throw new Error(`Memo not found: ${id}`);
    }
    return this.saveMemo({
      ...memo,
      deletedAt,
      updatedAt: deletedAt,
      windowState: { ...memo.windowState, visible: false },
      syncState: "queued"
    });
  }

  async restoreMemo(id: string, restoredAt: string): Promise<Memo> {
    const memos = await this.listMemos();
    const memo = memos.find((item) => item.id === id);
    if (!memo) {
      throw new Error(`Memo not found: ${id}`);
    }
    return this.saveMemo({
      ...memo,
      deletedAt: null,
      updatedAt: restoredAt,
      windowState: { ...memo.windowState, visible: true },
      syncState: "queued"
    });
  }
}
```

Create `apps/desktop/src/adapters/tauriPlatform.ts`:

```ts
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export async function exportTextFile(fileName: string, contents: string): Promise<string> {
  const selectedPath = await save({
    defaultPath: fileName,
    filters: [{ name: "Text", extensions: ["txt"] }]
  });

  if (!selectedPath) {
    return "취소됨";
  }

  await writeTextFile(selectedPath, contents);
  return selectedPath;
}

export async function getStartupEnabled(): Promise<boolean> {
  return isEnabled();
}

export async function setStartupEnabled(enabled: boolean): Promise<boolean> {
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
  return isEnabled();
}
```

- [ ] **Step 5: Wire desktop app to adapters with browser fallback**

Modify `apps/desktop/src/App.tsx` so repository/platform selection is explicit:

```tsx
import { createMemo, formatMemosAsCombinedText, MemoryMemoRepository, type Memo, type MemoRepository } from "@h-memo/memo-core";
import { SettingsPanel, StickyMemo } from "@h-memo/memo-ui";
import { useEffect, useMemo, useState } from "react";
import { TauriMemoRepository } from "./adapters/tauriMemoRepository";
import { exportTextFile, getStartupEnabled, setStartupEnabled as setTauriStartupEnabled } from "./adapters/tauriPlatform";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function createRepository(): MemoRepository {
  return isTauriRuntime() ? new TauriMemoRepository() : new MemoryMemoRepository();
}

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

export function App() {
  const repository = useMemo(() => createRepository(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [txtPreview, setTxtPreview] = useState("");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [backupStatus, setBackupStatus] = useState("아직 백업하지 않았습니다.");

  useEffect(() => {
    repository.listMemos().then(setMemos);
    if (isTauriRuntime()) {
      getStartupEnabled().then(setStartupEnabled).catch(() => setStartupEnabled(false));
    }
  }, [repository]);

  async function refresh() {
    setMemos(await repository.listMemos());
  }

  async function createNewMemo() {
    await repository.saveMemo(createMemo({ now: nowIso(), id: newId() }));
    await refresh();
  }

  async function saveMemo(memo: Memo) {
    await repository.saveMemo(memo);
    await refresh();
  }

  async function hideMemo(id: string) {
    const memo = memos.find((item) => item.id === id);
    if (!memo) return;
    await repository.saveMemo({
      ...memo,
      windowState: { ...memo.windowState, visible: false },
      updatedAt: nowIso(),
      syncState: "queued"
    });
    await refresh();
  }

  async function deleteMemo(id: string) {
    await repository.softDeleteMemo(id, nowIso());
    await refresh();
  }

  async function exportText() {
    const contents = formatMemosAsCombinedText(memos);
    setTxtPreview(contents);
    if (isTauriRuntime()) {
      const path = await exportTextFile("h-memo-backup.txt", contents);
      setBackupStatus(`TXT 저장 완료: ${path}`);
    }
  }

  async function toggleStartup(enabled: boolean) {
    setStartupEnabled(enabled);
    if (isTauriRuntime()) {
      setStartupEnabled(await setTauriStartupEnabled(enabled));
    }
  }

  const visibleMemos = memos.filter((memo) => memo.deletedAt === null && memo.windowState.visible);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>H Memo</h1>
        <button type="button" onClick={createNewMemo}>
          새 메모
        </button>
        <button type="button" onClick={() => setTxtPreview(formatMemosAsCombinedText(memos))}>
          TXT 미리보기
        </button>
      </header>

      <section className="memo-board" aria-label="메모 목록">
        {visibleMemos.length === 0 ? <p>트레이에서 열 새 메모를 만들어보세요.</p> : null}
        {visibleMemos.map((memo) => (
          <StickyMemo key={memo.id} memo={memo} onChange={saveMemo} onHide={hideMemo} onDelete={deleteMemo} />
        ))}
      </section>

      <SettingsPanel
        userName={null}
        backupStatus={backupStatus}
        startupEnabled={startupEnabled}
        onBackup={() => setBackupStatus(`로컬 백업 준비됨: ${new Date().toLocaleString("ko-KR")}`)}
        onRestore={() => setBackupStatus("복원할 서버 백업을 선택해야 합니다.")}
        onExportText={exportText}
        onToggleStartup={toggleStartup}
        onSignIn={() => setBackupStatus("Google 로그인은 백업 설정 후 활성화됩니다.")}
        onSignOut={() => setBackupStatus("로그아웃 상태입니다.")}
      />

      {txtPreview ? (
        <pre className="txt-preview" aria-label="TXT 미리보기 결과">
          {txtPreview}
        </pre>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 6: Run checks**

Run:

```bash
npm test
npm run build -w apps/desktop
npm run tauri:build -w apps/desktop
```

Expected:

- `npm test`: PASS.
- `npm run build -w apps/desktop`: PASS.
- `npm run tauri:build -w apps/desktop`: PASS on a machine with Rust and Tauri prerequisites. On macOS, Windows installer artifacts are not expected; Windows artifacts are covered by CI in Task 8.

- [ ] **Step 7: Commit Tauri shell**

Run:

```bash
git add apps/desktop/src apps/desktop/src-tauri apps/desktop/package.json
git commit -m "feat: add tauri desktop shell"
```

Expected: commit succeeds.

---

## Task 6: Firebase Backup Package

**Files:**

- Create: `packages/memo-sync/package.json`
- Create: `packages/memo-sync/tsconfig.json`
- Create: `packages/memo-sync/src/firebaseConfig.ts`
- Create: `packages/memo-sync/src/auth.ts`
- Create: `packages/memo-sync/src/backup.ts`
- Create: `packages/memo-sync/src/index.ts`
- Test: `packages/memo-sync/src/backup.test.ts`

- [ ] **Step 1: Create sync package metadata**

Create `packages/memo-sync/package.json`:

```json
{
  "name": "@h-memo/memo-sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@h-memo/memo-core": "0.1.0",
    "firebase": "^11.0.0"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `packages/memo-sync/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 2: Refresh workspace dependencies**

Run:

```bash
npm install
```

Expected: npm links `@h-memo/memo-sync` and installs Firebase.

- [ ] **Step 3: Write failing backup tests**

Create `packages/memo-sync/src/backup.test.ts`:

```ts
import { createMemo } from "@h-memo/memo-core";
import { describe, expect, it } from "vitest";
import { backupMemos, restoreLatestBackup, type BackupGateway } from "./backup";

class FakeBackupGateway implements BackupGateway {
  latest: unknown = null;
  savedPath = "";

  async saveBackup(userId: string, payload: unknown): Promise<string> {
    this.latest = payload;
    this.savedPath = `users/${userId}/backupSnapshots/snapshot-1`;
    return this.savedPath;
  }

  async loadLatestBackup(): Promise<unknown> {
    return this.latest;
  }
}

describe("backup", () => {
  it("saves a versioned backup payload", async () => {
    const gateway = new FakeBackupGateway();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });

    const result = await backupMemos({
      gateway,
      userId: "user-1",
      memos: [memo],
      createdAt: "2026-05-13T09:05:00.000Z"
    });

    expect(result.path).toBe("users/user-1/backupSnapshots/snapshot-1");
    expect(result.count).toBe(1);
  });

  it("restores only a valid backup for the current user", async () => {
    const gateway = new FakeBackupGateway();
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });

    await backupMemos({
      gateway,
      userId: "user-1",
      memos: [memo],
      createdAt: "2026-05-13T09:05:00.000Z"
    });

    const restored = await restoreLatestBackup({ gateway, userId: "user-1" });

    expect(restored.ok).toBe(true);
    expect(restored.ok ? restored.memos : []).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
npm test -- packages/memo-sync/src
```

Expected: FAIL because sync modules are missing.

- [ ] **Step 5: Implement Firebase config/auth/backup**

Create `packages/memo-sync/src/firebaseConfig.ts`:

```ts
import { initializeApp, type FirebaseApp } from "firebase/app";

export type FirebaseClientEnv = {
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
};

export function hasFirebaseConfig(env: FirebaseClientEnv): boolean {
  return Boolean(
    env.VITE_FIREBASE_API_KEY &&
      env.VITE_FIREBASE_AUTH_DOMAIN &&
      env.VITE_FIREBASE_PROJECT_ID &&
      env.VITE_FIREBASE_APP_ID
  );
}

export function createFirebaseApp(env: FirebaseClientEnv): FirebaseApp {
  if (!hasFirebaseConfig(env)) {
    throw new Error("Firebase client config is missing.");
  }

  return initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID
  });
}
```

Create `packages/memo-sync/src/auth.ts`:

```ts
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type Auth, type User } from "firebase/auth";
import type { FirebaseApp } from "firebase/app";

export type HMemoUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
};

export function toHMemoUser(user: User): HMemoUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email
  };
}

export function getFirebaseAuth(app: FirebaseApp): Auth {
  return getAuth(app);
}

export async function signInWithGoogle(auth: Auth): Promise<HMemoUser> {
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  return toHMemoUser(credential.user);
}

export async function signOutUser(auth: Auth): Promise<void> {
  await signOut(auth);
}
```

Create `packages/memo-sync/src/backup.ts`:

```ts
import { createBackupPayload, validateBackupPayload, type Memo } from "@h-memo/memo-core";
import { addDoc, collection, getDocs, limit, orderBy, query, type Firestore } from "firebase/firestore";

export type BackupGateway = {
  saveBackup(userId: string, payload: unknown): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown>;
};

export class FirestoreBackupGateway implements BackupGateway {
  constructor(private readonly db: Firestore) {}

  async saveBackup(userId: string, payload: unknown): Promise<string> {
    const ref = await addDoc(collection(this.db, "users", userId, "backupSnapshots"), payload);
    return ref.path;
  }

  async loadLatestBackup(userId: string): Promise<unknown> {
    const snapshots = await getDocs(
      query(collection(this.db, "users", userId, "backupSnapshots"), orderBy("createdAt", "desc"), limit(1))
    );
    return snapshots.docs[0]?.data() ?? null;
  }
}

export async function backupMemos({
  gateway,
  userId,
  memos,
  createdAt
}: {
  gateway: BackupGateway;
  userId: string;
  memos: Memo[];
  createdAt: string;
}): Promise<{ path: string; count: number }> {
  const payload = createBackupPayload({ userId, memos, createdAt });
  const path = await gateway.saveBackup(userId, payload);
  return { path, count: memos.length };
}

export async function restoreLatestBackup({
  gateway,
  userId
}: {
  gateway: BackupGateway;
  userId: string;
}): Promise<{ ok: true; memos: Memo[] } | { ok: false; reason: string }> {
  const payload = await gateway.loadLatestBackup(userId);
  const validation = validateBackupPayload(payload, userId);

  if (!validation.ok) {
    return validation;
  }

  return { ok: true, memos: validation.payload.memos };
}
```

Create `packages/memo-sync/src/index.ts`:

```ts
export * from "./auth";
export * from "./backup";
export * from "./firebaseConfig";
```

- [ ] **Step 6: Run sync tests and typecheck**

Run:

```bash
npm test -- packages/memo-sync/src
npm run typecheck
```

Expected: PASS for sync tests and typecheck.

- [ ] **Step 7: Commit memo-sync**

Run:

```bash
git add packages/memo-sync package-lock.json
git commit -m "feat: add firebase backup module"
```

Expected: commit succeeds.

---

## Task 7: Desktop Backup and Settings Wiring

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/App.test.tsx`

- [ ] **Step 1: Add desktop sync dependency**

Modify `apps/desktop/package.json` dependencies:

```json
{
  "dependencies": {
    "@h-memo/memo-core": "0.1.0",
    "@h-memo/memo-sync": "0.1.0",
    "@h-memo/memo-ui": "0.1.0",
    "@tauri-apps/api": "^2.2.0",
    "@tauri-apps/plugin-autostart": "^2.2.0",
    "@tauri-apps/plugin-dialog": "^2.2.0",
    "@tauri-apps/plugin-fs": "^2.2.0",
    "firebase": "^11.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

Run:

```bash
npm install
```

Expected: `apps/desktop` can import `@h-memo/memo-sync`.

- [ ] **Step 2: Extend app test for backup status**

Modify `apps/desktop/src/App.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("desktop App", () => {
  it("creates a memo, edits it, and exports text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    await user.clear(screen.getByLabelText("메모 제목"));
    await user.type(screen.getByLabelText("메모 제목"), "윈도우 메모");
    await user.type(screen.getByLabelText("메모 내용"), "트레이에서 열리는 메모");
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    expect(screen.getByText(/제목: 윈도우 메모/)).toBeInTheDocument();
    expect(screen.getByText(/트레이에서 열리는 메모/)).toBeInTheDocument();
  });

  it("keeps backup actions safe when Firebase is not configured", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "서버 백업" }));

    expect(screen.getByRole("status")).toHaveTextContent("Firebase 설정이 없어 로컬 모드로 실행 중입니다.");
  });
});
```

- [ ] **Step 3: Run test and verify failure**

Run:

```bash
npm test -- apps/desktop/src/App.test.tsx
```

Expected: FAIL because backup button status still uses the old temporary local-only message.

- [ ] **Step 4: Wire safe Firebase backup status**

Modify the backup-related parts of `apps/desktop/src/App.tsx`:

```tsx
import { hasFirebaseConfig } from "@h-memo/memo-sync";

const firebaseEnv = import.meta.env;

function firebaseReady() {
  return hasFirebaseConfig(firebaseEnv);
}
```

Replace the `SettingsPanel` backup handlers with:

```tsx
<SettingsPanel
  userName={null}
  backupStatus={backupStatus}
  startupEnabled={startupEnabled}
  onBackup={() => {
    if (!firebaseReady()) {
      setBackupStatus("Firebase 설정이 없어 로컬 모드로 실행 중입니다.");
      return;
    }
    setBackupStatus(`서버 백업 준비됨: ${new Date().toLocaleString("ko-KR")}`);
  }}
  onRestore={() => {
    if (!firebaseReady()) {
      setBackupStatus("Firebase 설정이 없어 복원을 건너뛰었습니다.");
      return;
    }
    setBackupStatus("최신 서버 백업을 확인합니다.");
  }}
  onExportText={exportText}
  onToggleStartup={toggleStartup}
  onSignIn={() => {
    if (!firebaseReady()) {
      setBackupStatus("Firebase 설정이 없어 Google 로그인을 사용할 수 없습니다.");
      return;
    }
    setBackupStatus("Google 로그인 창을 엽니다.");
  }}
  onSignOut={() => setBackupStatus("로그아웃 상태입니다.")}
/>
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- apps/desktop/src/App.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit settings wiring**

Run:

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx
git commit -m "feat: wire backup and settings status"
```

Expected: commit succeeds.

---

## Task 8: Firestore Rules, Windows CI, Release Checklist

**Files:**

- Create: `firebase.json`
- Create: `firestore.rules`
- Create: `.github/workflows/windows-build.yml`
- Create: `docs/release/windows-mvp-checklist.md`

- [ ] **Step 1: Add Firebase rules files**

Create `firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

Create `firestore.rules`:

```text
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function ownsUserDoc(userId) {
      return signedIn() && request.auth.uid == userId;
    }

    match /users/{userId}/memos/{memoId} {
      allow read, write: if ownsUserDoc(userId);
    }

    match /users/{userId}/backupSnapshots/{snapshotId} {
      allow read, write: if ownsUserDoc(userId);
    }
  }
}
```

- [ ] **Step 2: Add Windows build workflow**

Create `.github/workflows/windows-build.yml`:

```yaml
name: Windows Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  windows-build:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build desktop app
        run: npm run build -w apps/desktop

      - name: Build Windows installer
        run: npm run tauri:build -w apps/desktop

      - name: Upload Tauri bundles
        uses: actions/upload-artifact@v4
        with:
          name: h-memo-windows-bundles
          path: apps/desktop/src-tauri/target/release/bundle/**
```

- [ ] **Step 3: Add release checklist**

Create `docs/release/windows-mvp-checklist.md`:

```markdown
# H Memo Windows MVP Release Checklist

## Automated Checks

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build -w apps/desktop`
- [ ] `npm run tauri:build -w apps/desktop`
- [ ] GitHub Actions `Windows Build` succeeds.
- [ ] Windows bundle artifact is downloadable.

## Manual Windows Smoke Test

- [ ] Install H Memo from the generated setup executable or MSI.
- [ ] Launch H Memo.
- [ ] Confirm H Memo appears in the Windows system tray.
- [ ] Double-click the tray icon and confirm a sticky memo opens or focuses.
- [ ] Create a new memo.
- [ ] Edit memo title and body.
- [ ] Change memo background color.
- [ ] Change text color, font family, and font size.
- [ ] Hide a memo and confirm it is not deleted.
- [ ] Delete a memo and confirm deletion requires intentional action in the UI.
- [ ] Quit and relaunch; confirm saved memos return.
- [ ] Export TXT backup and open the file in Notepad.
- [ ] Toggle startup registration and confirm the UI state changes.
- [ ] With Firebase env configured, sign in with Google.
- [ ] Back up memos to the server.
- [ ] Restore latest backup without losing local data.
```

- [ ] **Step 4: Run repository checks**

Run:

```bash
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit release infrastructure**

Run:

```bash
git add firebase.json firestore.rules .github/workflows/windows-build.yml docs/release/windows-mvp-checklist.md
git commit -m "chore: add windows release infrastructure"
```

Expected: commit succeeds.

---

## Task 9: Final Local Verification and Handoff

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update README with current status**

Modify `README.md`:

```markdown
# H Memo

H Memo is a local-first sticky memo app. The first target is a Windows desktop app built with Tauri 2, React, and TypeScript. Shared memo logic lives in packages so a future web/PWA version can reuse the same model and UI.

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Desktop

```bash
npm run tauri:dev
npm run tauri:build
```

## Firebase Backup

Copy `.env.example` to `.env.local` and fill the Firebase client values when cloud backup is needed. The app remains usable in local-only mode when Firebase config is absent.

## Windows Release

Run the GitHub Actions `Windows Build` workflow or build on a Windows machine with Node, Rust, and Tauri prerequisites installed. Use `docs/release/windows-mvp-checklist.md` for the final smoke test.
```

- [ ] **Step 2: Run full local checks**

Run:

```bash
npm run typecheck
npm test
npm run build -w apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Try desktop build**

Run:

```bash
npm run tauri:build -w apps/desktop
```

Expected:

- PASS if local Rust/Tauri prerequisites are installed.
- If local macOS build cannot produce Windows installer artifacts, record that Windows artifact verification is delegated to `.github/workflows/windows-build.yml`.

- [ ] **Step 4: Commit final handoff docs**

Run:

```bash
git add README.md
git commit -m "docs: document h memo development workflow"
```

Expected: commit succeeds if README changed.

- [ ] **Step 5: Final report**

Report:

```text
Implemented H Memo Windows MVP foundation.

Verified:
- npm run typecheck
- npm test
- npm run build -w apps/desktop
- npm run tauri:build -w apps/desktop

Notes:
- Windows installer artifact is produced by the Windows Build workflow.
- Firebase backup remains opt-in and requires .env.local values.
```

---

## Self-Review

- Spec coverage: The plan covers local-first memos, system tray, sticky UI, formatting controls, user-selected local text backup, Firebase backup foundations, startup registration through the Tauri autostart plugin, Windows packaging, and release verification.
- Deliberate scope split: The future web/PWA app is prepared through shared packages but is not implemented in this MVP plan.
- Gap scan: The plan avoids open-ended implementation gaps; every code step includes concrete file content or concrete replacement content.
- Type consistency: Core type names are `Memo`, `MemoStyle`, `MemoWindowState`, `MemoRepository`, and `BackupPayload` across packages.
- Risk note: Tauri tray/startup APIs can require syntax adjustment against the installed Tauri 2 minor version. If a Rust compile error appears, fix the exact API call while preserving the command names and behavior in this plan.
