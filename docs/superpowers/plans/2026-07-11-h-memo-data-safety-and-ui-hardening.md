# H Memo Data Safety And UI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden H Memo's test isolation, desktop multi-window persistence, Firestore backup model, restore safety, and menu accessibility without breaking existing Windows, macOS, or web data.

**Architecture:** Keep `Memo` and local JSON backup version 1 for compatibility. Move desktop process coordination into Tauri-managed Rust state, move cloud persistence to immutable per-memo snapshot documents plus canonical per-memo documents, and place restore-point logic in `memo-core` so desktop and web use the same safety contract. Shared UI remains in `memo-ui`; platform apps supply behavior and status.

**Tech Stack:** TypeScript 5, React 19, Vitest 4, Tauri 2, Rust/rusqlite, Firebase Auth/Firestore, CSS.

## Global Constraints

- Preserve existing user memos and continue reading legacy Firestore version 1 snapshot documents that contain an inline `memos` array.
- Keep local JSON `BackupPayload.version` equal to `1`; Firestore's new storage schema is independently identified as `schemaVersion: 2`.
- Never place all memo bodies in one Firestore document; every current memo and every snapshot memo must have its own document.
- Use Firestore `serverTimestamp()` as the authoritative ordering/display time for new server backups; client `createdAt` is metadata and a legacy fallback only.
- A server memo deletion writes a tombstone and clears that snapshot from the canonical memo's active/pending references; the canonical ownership record and immutable historical snapshot documents are retained.
- A restore must create a durable local safety point before mutating local memos, and the user must be able to undo the latest successful restore.
- Prevent more than one native window from owning the same memo ID, including the main window and child windows.
- Serialize all SQLite access through one Tauri-managed connection configured with WAL and a 5-second busy timeout.
- Use test-first red-green-refactor for every behavior change and keep test output free of warnings.
- Do not touch the user-owned untracked `h-memo-public-menu-fix.png` or `img/` files in the main checkout.

---

### Task 1: Contain Test Discovery And Guarantee macOS Staging Cleanup

**Files:**
- Create: `scripts/lib/vitest-boundaries.js`
- Create: `scripts/test-boundaries.test.ts`
- Modify: `vitest.config.ts`
- Modify: `scripts/build-macos-internal.mjs`
- Modify: `scripts/macos-build-scripts.test.ts`

**Interfaces:**
- Produces: `VITEST_INCLUDE_PATTERNS: string[]`, `VITEST_EXCLUDE_PATTERNS: string[]`, and `isVitestExcludedPath(pathname: string): boolean`; the arrays are consumed directly by `vitest.config.ts` and the predicate verifies the same generated-directory boundary.
- Produces: exported `createInternalDmg()` behavior that always removes `target/release/bundle/dmg/internal-staging`, whether `hdiutil` succeeds or fails.

- [ ] **Step 1: Write failing boundary and cleanup tests**

  Add assertions that the configured include patterns accept repository tests, exclude any path below `node_modules`, `dist`, `.worktrees`, and every `target` directory, and that the macOS script contains a `try/finally` cleanup around `hdiutil`. Also assert command failure is thrown rather than calling `process.exit` inside `run()`.

  ```ts
  expect(isExcluded("apps/desktop/src-tauri/target/release/bundle/dmg/internal-staging/Applications/Foo.test.js")).toBe(true);
  expect(isExcluded("packages/memo-core/src/memoFactory.test.ts")).toBe(false);
  expect(buildScript).toMatch(/try\s*\{[\s\S]*run\("hdiutil"[\s\S]*\}\s*finally\s*\{/);
  ```

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npm test -- --pool=forks scripts/test-boundaries.test.ts scripts/macos-build-scripts.test.ts`

  Expected: FAIL because explicit Vitest boundary exports and guaranteed cleanup do not exist.

- [ ] **Step 3: Implement explicit test boundaries and exception-safe cleanup**

  Export arrays from `scripts/lib/vitest-boundaries.js`, import them into `vitest.config.ts`, and configure both `test.include` and `test.exclude`. Include only `**/*.{test,spec}.{js,mjs,cjs,ts,tsx}` and exclude `**/node_modules/**`, `**/dist/**`, `**/dist-ssr/**`, `**/coverage/**`, `**/.worktrees/**`, and `**/target/**`.

  Change `run()` to throw an error carrying the failed exit status. Wrap DMG staging creation and `hdiutil` execution in `try/finally` so the staging directory is removed on every path.

- [ ] **Step 4: Verify GREEN and the full baseline**

  Run: `npm test -- --pool=forks scripts/test-boundaries.test.ts scripts/macos-build-scripts.test.ts`

  Expected: focused tests PASS.

  Run: `npm test -- --pool=forks`

  Expected: all repository tests PASS without scanning generated Tauri paths.

- [ ] **Step 5: Commit**

  ```bash
  git add vitest.config.ts scripts/lib/vitest-boundaries.js scripts/test-boundaries.test.ts scripts/build-macos-internal.mjs scripts/macos-build-scripts.test.ts
  git commit -m "test: isolate generated build paths"
  ```

---

### Task 2: Enforce One Window Per Memo And Serialize SQLite

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/adapters/tauriWindow.ts`
- Modify: `apps/desktop/src/adapters/tauriWindow.test.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/App.test.tsx`

**Interfaces:**
- Produces Rust state `DatabaseState(Mutex<Connection>)` and `MemoWindowRegistry(Mutex<HashMap<String, String>>)`.
- Produces Tauri commands `claim_memo_window(memo_id, window_label) -> MemoWindowClaim`, `release_memo_window(memo_id, window_label)`, and existing `list_memos`/`save_memo` backed by shared `DatabaseState`.
- Produces TypeScript helpers `claimCurrentMemoWindow(memoId)`, `releaseCurrentMemoWindow(memoId)`, and an updated `openMemoWindow(memo)` that focuses the registered owner instead of creating a duplicate.

- [ ] **Step 1: Write failing Rust database/registry tests and TypeScript window tests**

  Add Rust tests around pure helpers using an in-memory SQLite connection: schema initialization enables `journal_mode` compatible with the connection, sets `busy_timeout` to 5000 milliseconds, and serial upserts return the newest memo. Add registry tests for first claim, same-owner idempotence, different-owner rejection, and release.

  Add adapter/App tests showing that when `memo-1` is claimed by `main`, `openMemoWindow(memo-1)` focuses `main` and creates no `WebviewWindow`; when an active memo changes, the previous ID is released and the new ID is claimed.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline database`

  Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline window_registry`

  Run: `npm test -- --pool=forks apps/desktop/src/adapters/tauriWindow.test.ts apps/desktop/src/App.test.tsx`

  Expected: FAIL because managed database/window ownership APIs do not exist.

- [ ] **Step 3: Add managed SQLite state**

  Open the app database once in Tauri `setup`, run schema initialization, execute `PRAGMA journal_mode=WAL`, and call `connection.busy_timeout(Duration::from_secs(5))`. Register `DatabaseState` with `app.manage(...)`. Change `list_memos` and `save_memo` to lock this shared connection through `tauri::State` and never open a second connection per command.

- [ ] **Step 4: Add atomic memo-window ownership**

  Implement an in-process registry keyed by memo ID. `claim_memo_window` must atomically reserve an unowned ID, allow the same label to re-claim, and focus/show an existing different owner before returning `{ claimed: false, windowLabel }`. Remove stale owners when their Tauri window no longer exists. `release_memo_window` must only release when both memo ID and owner label match.

  In TypeScript, reserve the deterministic child label before constructing `WebviewWindow`; release the reservation on creation failure. In `App.tsx`, claim the current window's active/requested memo and release it on memo change or unmount.

- [ ] **Step 5: Verify GREEN and concurrency-sensitive gates**

  Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline`

  Run: `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --offline -- -D warnings`

  Run: `npm test -- --pool=forks apps/desktop/src/adapters/tauriWindow.test.ts apps/desktop/src/App.test.tsx`

  Run: `npm run typecheck`

  Expected: all commands exit 0 with no duplicate-window regression or Rust warning.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src/adapters/tauriWindow.ts apps/desktop/src/adapters/tauriWindow.test.ts apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx
  git commit -m "fix: serialize memo windows and sqlite writes"
  ```

---

### Task 3: Store Firestore Backups Per Memo With Server-Time History

**Files:**
- Modify: `packages/memo-sync/src/backup.ts`
- Modify: `packages/memo-sync/src/backup.test.ts`
- Modify: `packages/memo-sync/src/index.ts`
- Modify: `firestore.rules`
- Modify: `scripts/firestore-rules-policy.test.ts`
- Modify: `apps/desktop/src/App.test.tsx`
- Modify: `apps/web/src/WebApp.test.tsx`
- Modify: `docs/firebase-setup.md`

**Interfaces:**
- Produces `StoredBackupSnapshot = { id: string; payload: MemoBackupPayload; savedAt: string }` and server-time `BackedUpSnapshot.createdAt`.
- New Firestore paths: canonical `users/{uid}/memos/{memoId}`, metadata `users/{uid}/backupSnapshots/{snapshotId}`, immutable snapshot memo `users/{uid}/backupSnapshots/{snapshotId}/memos/{memoId}`, existing tombstone `users/{uid}/serverMemoDeletes/{memoId}`.
- New snapshot metadata fields: `{ schemaVersion: 2, userId, createdAt, memoCount, state: "writing" | "complete", savedAt }`.
- Legacy version 1 inline snapshot reads remain supported.

- [ ] **Step 1: Write failing gateway contract, ordering, compatibility, and rules tests**

  Extend the fake gateway to expose canonical current memos and stored snapshots with independent `savedAt`. Test that server history sorts by `savedAt` even when client `createdAt` is skewed, canonical memo listing does not scan every historical snapshot, deleting a server memo clears the matching canonical active/pending references and writes a tombstone without rewriting snapshots, re-backup clears the tombstone, and legacy inline version 1 snapshots still restore.

  Add policy assertions for owner-only canonical memo documents, owner-only schema-v2 metadata, immutable snapshot memo documents, and continued read support for version-1 snapshots.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npm test -- --pool=forks packages/memo-sync/src/backup.test.ts scripts/firestore-rules-policy.test.ts apps/desktop/src/App.test.tsx apps/web/src/WebApp.test.tsx`

  Expected: FAIL because current storage uses one inline array document and client timestamps for history.

- [ ] **Step 3: Implement per-memo snapshot writes**

  Generate a snapshot document reference before writing. Create metadata with `state: "writing"`, then write active memo documents in batches of at most 200 memos so each batch stays below Firestore's 500-operation limit while updating both canonical and snapshot memo paths. Finish by setting `state: "complete"` and `savedAt: serverTimestamp()`. Delete tombstones for successfully backed-up active memos.

  Read only complete schema-v2 snapshots, load their `memos` subcollection, and normalize Firestore timestamps through a helper that accepts a Firebase `Timestamp` (`toDate()`) or ISO string. Continue parsing legacy inline version-1 documents. Use server `savedAt` for list order and user-visible history time.

- [ ] **Step 4: Implement canonical server memo management and immutable deletion**

  `listBackedUpMemos` must read `users/{uid}/memos` and filter tombstones. `deleteBackedUpMemo` must set the tombstone and clear references to the deleted snapshot from the canonical memo document; it must not delete the canonical ownership record or update any snapshot document. Historical restore remains possible only for memo IDs not tombstoned until a later successful backup clears that tombstone.

- [ ] **Step 5: Update security rules and Firebase documentation**

  Permit owner reads/writes for canonical memo documents with `userId`, `memoId`, bounded active/pending snapshot references, and timestamp shape checks while denying canonical physical deletion. Permit owner creation of schema-v2 metadata and nested snapshot memo documents, but deny nested snapshot updates/deletes. Keep owner reads for legacy version-1 snapshots and retain existing tombstone ownership checks. Document the v2 paths and migration behavior.

- [ ] **Step 6: Verify GREEN and full sync gates**

  Run: `npm test -- --pool=forks packages/memo-sync/src/backup.test.ts scripts/firestore-rules-policy.test.ts apps/desktop/src/App.test.tsx apps/web/src/WebApp.test.tsx`

  Run: `npm run typecheck`

  Run: `npm run build`

  Expected: all commands exit 0; production bundles build and legacy snapshots remain readable.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/memo-sync/src/backup.ts packages/memo-sync/src/backup.test.ts packages/memo-sync/src/index.ts firestore.rules scripts/firestore-rules-policy.test.ts apps/desktop/src/App.test.tsx apps/web/src/WebApp.test.tsx docs/firebase-setup.md
  git commit -m "feat: store cloud backups per memo"
  ```

---

### Task 4: Add Durable Restore Points And One-Step Undo

**Files:**
- Create: `packages/memo-core/src/restoreSafety.ts`
- Create: `packages/memo-core/src/restoreSafety.test.ts`
- Modify: `packages/memo-core/src/index.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/App.test.tsx`
- Modify: `apps/web/src/WebApp.tsx`
- Modify: `apps/web/src/WebApp.test.tsx`
- Modify: `packages/memo-ui/src/SettingsPanel.tsx`
- Modify: `packages/memo-ui/src/SettingsPanel.test.tsx`

**Interfaces:**
- Produces `RESTORE_SAFETY_STORAGE_KEY = "h-memo:restore-safety-v1"`.
- Produces `RestoreSafetyPoint = { version: 1; source: "server" | "json"; createdAt: string; payload: BackupPayload }`.
- Produces `saveRestoreSafetyPoint(storage, point)`, `loadRestoreSafetyPoint(storage)`, and `clearRestoreSafetyPoint(storage)` using the standard `Storage` interface.
- Adds `canUndoRestore?: boolean` and `onUndoRestore?: () => void` to `SettingsPanelProps`.

- [ ] **Step 1: Write failing core and app-flow tests**

  Test valid round-trip, malformed storage rejection, and storage quota errors in `restoreSafety.test.ts`. In desktop and web app tests, assert a safety point containing all current local memos is persisted before server or JSON restore writes begin; abort restore if safety-point persistence fails; show `마지막 복원 되돌리기` after success; and undo replaces local state with the saved point without overwriting that point first.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npm test -- --pool=forks packages/memo-core/src/restoreSafety.test.ts packages/memo-ui/src/SettingsPanel.test.tsx apps/desktop/src/App.test.tsx apps/web/src/WebApp.test.tsx`

  Expected: FAIL because no durable restore point or undo action exists.

- [ ] **Step 3: Implement shared safety-point persistence**

  Validate the envelope and nested version-1 backup payload on load. Throw a user-readable error when storage write fails; do not silently continue. Both apps must create the point from `repository.listMemos()` immediately before calling the existing replacement transaction.

- [ ] **Step 4: Add confirmation and undo flows**

  Keep JSON confirmation and add snapshot confirmation containing localized backup time and memo count. On successful restore, preserve the safety point and enable the undo action. Undo must call the existing rollback-capable replacement path with the safety payload, then clear the point only after replacement succeeds. A failed undo retains the point for retry.

- [ ] **Step 5: Verify GREEN and both-platform behavior**

  Run: `npm test -- --pool=forks packages/memo-core/src/restoreSafety.test.ts packages/memo-ui/src/SettingsPanel.test.tsx apps/desktop/src/App.test.tsx apps/web/src/WebApp.test.tsx`

  Run: `npm run typecheck`

  Expected: all focused tests and type checks PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/memo-core/src/restoreSafety.ts packages/memo-core/src/restoreSafety.test.ts packages/memo-core/src/index.ts apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx apps/web/src/WebApp.tsx apps/web/src/WebApp.test.tsx packages/memo-ui/src/SettingsPanel.tsx packages/memo-ui/src/SettingsPanel.test.tsx
  git commit -m "feat: add safe restore undo"
  ```

---

### Task 5: Improve Menu Accessibility And Cross-Platform Presentation

**Files:**
- Create: `packages/memo-ui/src/formatDateTime.ts`
- Create: `packages/memo-ui/src/formatDateTime.test.ts`
- Modify: `packages/memo-ui/src/StickyMemo.tsx`
- Modify: `packages/memo-ui/src/StickyMemo.test.tsx`
- Modify: `packages/memo-ui/src/MemoToolbar.tsx`
- Modify: `packages/memo-ui/src/MemoToolbar.test.tsx`
- Modify: `packages/memo-ui/src/SettingsPanel.tsx`
- Modify: `packages/memo-ui/src/SettingsPanel.test.tsx`
- Modify: `packages/memo-ui/src/ServerMemoManagerDialog.tsx`
- Modify: `packages/memo-ui/src/ServerMemoManagerDialog.test.tsx`
- Modify: `packages/memo-ui/src/index.ts`
- Modify: `apps/desktop/src/styles.css`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/index.html`
- Modify: `apps/web/package.json`
- Modify: `README.md`

**Interfaces:**
- Produces `formatDateTime(value: string, locale = "ko-KR") -> string`, returning `날짜 정보 없음` for invalid or empty input.
- Shared menu groups use native `<details>`/`<summary>` disclosure controls with visible focus, keyboard activation, and no horizontal overflow.
- Web sticky notes render no native drag affordance, drag tooltip, Tauri drag attribute, or resize handle unless the corresponding handler is provided.

- [ ] **Step 1: Write failing accessibility and presentation tests**

  Add tests for Korean localized timestamps and invalid values. Assert SettingsPanel exposes disclosure groups named `계정`, `백업 및 복원`, and `시작프로그램`; menu actions remain keyboard reachable; destructive server delete has a distinct class; Escape closes an open memo menu and restores focus to its summary; and web-mode `StickyMemo` omits native drag/resize affordances. Add a static test assertion that the web viewport permits user zoom.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npm test -- --pool=forks packages/memo-ui/src/formatDateTime.test.ts packages/memo-ui/src/StickyMemo.test.tsx packages/memo-ui/src/MemoToolbar.test.tsx packages/memo-ui/src/SettingsPanel.test.tsx packages/memo-ui/src/ServerMemoManagerDialog.test.tsx apps/web/src/WebApp.test.tsx`

  Expected: FAIL because the current long menu, raw timestamps, and web drag chrome do not meet the new contract.

- [ ] **Step 3: Reorganize shared menus and native-only affordances**

  Convert SettingsPanel's major sections to disclosure groups, keeping backup status visible with `role="status"`. Keep primary commands neutral, style permanent/server deletion as destructive, and preserve all existing callbacks. Add Escape handling to close the memo `<details>` menu and return focus to its summary. Apply drag attributes, movement tooltip, drag cursor, and resize handle only when native callbacks are present.

- [ ] **Step 4: Apply accessible sizing, focus, overflow, and typography**

  Give form controls and menu commands a minimum 40px block size, retain compact 32px top-bar icon controls with at least a 24px pointer target, add `:focus-visible` outlines, restore textarea focus indication, constrain menu width to `min(320px, calc(100vw - 16px))`, set `min-width: 0` on flex/grid children, and prevent horizontal overflow without hiding vertical content. Keep cards at 8px radius or less.

  Replace raw ISO backup dates with `formatDateTime`. Change skipped menu headings to a sequential hierarchy. Remove `maximum-scale=1` and `user-scalable=no` from the web viewport. Add `"dev": "vite --host 127.0.0.1"` to `apps/web/package.json` so README's web development command is true.

- [ ] **Step 5: Verify GREEN, responsive layout, and production gates**

  Run: `npm test -- --pool=forks`

  Run: `npm run typecheck`

  Run: `npm run build`

  Expected: all commands exit 0. At 320px and 768px viewport widths, the app menu has no horizontal scrollbar, focus indicators are visible, and web notes show no fake native resize handle.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/memo-ui/src apps/desktop/src/styles.css apps/web/src/styles.css apps/web/index.html apps/web/package.json README.md package-lock.json
  git commit -m "feat: improve memo menu accessibility"
  ```

---

## Final Verification

- [ ] Run `npm test -- --pool=forks` and confirm zero failures and no generated-path discovery.
- [ ] Run `npm run typecheck` and confirm all workspaces pass.
- [ ] Run `npm run build` and confirm desktop and web production bundles build.
- [ ] Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline` and confirm all Rust tests pass.
- [ ] Run `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --offline -- -D warnings` and confirm zero warnings.
- [ ] Inspect `git diff --check` and confirm no whitespace errors.
- [ ] Run final whole-branch review against the merge base and fix all Critical/Important findings before presenting branch integration options.
