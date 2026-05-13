# H Memo Design Spec

## 1. Purpose

H Memo is a local-first sticky memo application that runs first as a Windows desktop app and later expands to web, smartphone, and macOS. The first release should feel like a lightweight Windows utility: it lives in the system tray, opens quickly, shows sticky-note style memo windows, saves locally without friction, and lets the user back up notes with Google login or export them as text files.

The long-term product direction is cross-platform continuity. The memo editor, data model, formatting model, export logic, and cloud backup logic should be written in TypeScript-first shared packages so they can be reused by a future web/PWA app and by additional Tauri desktop targets.

## 2. Product Scope

### MVP

- Windows desktop app built with Tauri 2.
- System tray icon shown while the app is running.
- Double-clicking the tray icon opens or focuses the most recent sticky memo.
- Tray context menu includes new memo, show all memos, backup, settings, and quit.
- Sticky memo windows support create, edit, move, resize, hide, delete, and restore.
- Memo appearance supports background color, text font family, text size, and text color.
- Memo content supports rich text editing through a reusable React editor.
- Local automatic saving works without login.
- Google login enables cloud backup and restore.
- Local `.txt` export backs up memo text to a user-selected folder.
- Startup registration can be enabled or disabled in settings.
- Windows build outputs a user-installable setup executable or MSI installer.

### Later Releases

- Web/PWA app using the same memo packages.
- macOS desktop app through the same Tauri shell.
- Smartphone access through PWA first, then native wrapper if needed.
- Cross-device sync with conflict review.
- Import from `.txt` and structured backup JSON.
- Search, tags, pinning, reminders, and attachments.

### Non-Goals for MVP

- Real-time collaborative editing.
- Team sharing or public memo links.
- File attachments, images, handwriting, or OCR.
- End-to-end encryption before the base backup/sync model is proven.
- Store distribution through Microsoft Store, Apple App Store, or mobile stores.

## 3. Recommended Architecture

Use a monorepo with desktop and future web apps separated from reusable packages.

```text
h-memo/
  apps/
    desktop/        # Tauri 2 desktop app, initially Windows-focused
    web/            # Future web/PWA app
  packages/
    memo-core/      # Data model, reducers, validation, export helpers
    memo-ui/        # React sticky note, toolbar, settings, editor UI
    memo-sync/      # Firebase auth, Firestore backup, sync queue
```

The desktop app should be the first app target, but it should not own the core memo logic. Tauri should provide platform capabilities only: tray behavior, window creation, file dialogs, local database access, startup registration, and installer packaging.

## 4. Technology Choices

- Frontend language: TypeScript.
- UI framework: React.
- Desktop shell: Tauri 2 with Rust commands for native capabilities.
- Rich text editor: Tiptap/ProseMirror JSON as the durable rich text format.
- Local desktop storage: SQLite through a Tauri storage adapter.
- Future web local storage: IndexedDB adapter using the same repository interface.
- Cloud backup: Firebase Authentication with Google provider and Cloud Firestore.
- Packaging: Tauri Windows installer, preferably NSIS setup executable for early releases.
- CI build target: GitHub Actions Windows runner for reliable Windows artifacts.

This keeps the app web-compatible while still giving Windows-native behavior where needed.

## 5. Desktop Behavior

### System Tray

The app starts into the Windows system tray. The tray icon remains active even when all memo windows are hidden.

Tray actions:

- Double-click: open or focus the most recently active memo. If no memo exists, create one.
- Right-click menu: new memo, show all memos, cloud backup, local text export, settings, quit.
- Quit: ask for confirmation only if a save or backup operation is currently pending.

### Memo Windows

Each memo appears as a sticky-note style frameless window managed by Tauri. Window position, size, visibility, z-order preference, and note color are saved locally.

Expected window behavior:

- Hidden memos are not deleted.
- Closing a memo hides it by default.
- Delete requires confirmation.
- Resizing and moving should persist.
- A settings window is separate from memo windows.

## 6. Data Model

Core entities:

```ts
type Memo = {
  id: string;
  title: string;
  plainText: string;
  richContent: unknown;
  style: MemoStyle;
  windowState: MemoWindowState;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncState: "local-only" | "queued" | "backed-up" | "conflict";
};

type MemoStyle = {
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
};

type MemoWindowState = {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  visible: boolean;
  alwaysOnTop: boolean;
};
```

The durable rich text format is Tiptap/ProseMirror JSON. `plainText` is stored separately for search, quick preview, and `.txt` export. Soft delete is used so accidental deletion can be restored before a permanent cleanup action.

## 7. Storage and Backup

### Local Storage

The app is local-first. Notes are usable without login and save automatically to local SQLite. A repository interface in `memo-core` hides whether the backing store is SQLite, IndexedDB, or test memory storage.

### Cloud Backup

Cloud backup is user-owned data under Firebase Authentication UID paths:

```text
users/{uid}/memos/{memoId}
users/{uid}/backupSnapshots/{snapshotId}
```

MVP cloud behavior:

- Login with Google.
- Manual backup all local memos.
- Manual restore from the latest cloud backup.
- Show last backup time and backup result.
- Keep local data intact if login, backup, or restore fails.

The first release should call this "backup" rather than promise seamless real-time sync. The architecture still keeps a `memo-sync` queue so future cross-device sync can be added without rewriting the app.

### Text Export

Local text backup exports one `.txt` file per memo or a single combined `.txt` file, selected by the user at export time. The exported text includes memo title, updated time, and plain text content. Rich formatting is not preserved in `.txt`.

## 8. Authentication

Google authentication must use a secure system-browser flow, not an embedded WebView login screen. The desktop app opens the user's default browser and receives the OAuth result through a desktop-safe redirect flow. The future web app can use Firebase web auth directly.

The app should never store raw Google passwords or hard-coded refresh tokens. In the MVP, Google OAuth should return tokens through the system-browser flow, then Firebase Auth should own the signed-in session. Application code may store the Firebase user id and display profile metadata locally, but it must not create its own long-lived Google token store.

## 9. UI Design Direction

The visual style should be quiet and utility-focused, not a marketing landing page. The first screen is the actual memo experience.

Main surfaces:

- Sticky memo window: editable memo, compact toolbar, color/font controls, hide/delete controls.
- Tray menu: quick command surface.
- Settings window: login state, backup status, startup registration, export options.
- Backup status panel: clear feedback for backup success, restore success, pending work, and failures.

Controls:

- Use icon buttons for common commands such as new memo, hide, delete, backup, restore, and settings.
- Use color swatches for memo background and text color.
- Use menus/selects for font family.
- Use numeric stepper or compact dropdown for font size.
- Use a toggle for startup registration.

## 10. Error Handling

- Local save failure: keep the editor open, show a persistent save warning, and retry.
- Backup failure: keep local data untouched, show the reason, and allow retry.
- Restore failure: do not overwrite local data unless the full restore payload is validated.
- Conflicting cloud/local memo versions: MVP keeps the newest local version and records a conflict marker for later review.
- Invalid backup data: reject import/restore and explain that local data was not changed.
- App startup after crash: reopen with saved memos and show an unobtrusive recovery notice if needed.

## 11. Security and Privacy

- Store each user's cloud data under their Firebase UID.
- Firestore rules must prevent users from reading or writing another user's memos.
- Keep Firebase config public-safe and store no service account secrets in the desktop app.
- Avoid broad Google Drive scopes in MVP. Firebase Auth plus Firestore is enough.
- Do not send memo contents to analytics.
- Make cloud backup opt-in through Google login.
- Provide a local-only mode.

## 12. Testing Strategy

Unit tests:

- Memo model validation.
- Style updates.
- Plain text extraction from rich content.
- `.txt` export formatting.
- Backup payload validation.
- Repository adapter contract tests.

Desktop integration tests:

- App starts with tray enabled.
- Tray double-click opens or focuses a memo.
- Create, edit, hide, restore, and delete memo flows.
- Startup registration toggle calls the correct Tauri command.
- Local export writes expected text content.

Cloud tests:

- Firebase emulator tests for Firestore rules.
- Backup succeeds for signed-in user.
- Backup is denied for another user's path.
- Restore rejects invalid payloads.

Release verification:

- Type check.
- Unit tests.
- Desktop build.
- Windows installer artifact generated.
- Manual Windows smoke test for tray, memo window, local save, export, login, backup, and startup registration.

## 13. Implementation Phases

### Phase 1: Foundation

- Initialize monorepo.
- Create Tauri desktop app with React and TypeScript.
- Create `memo-core`, `memo-ui`, and `memo-sync` packages.
- Add baseline tests and build scripts.

### Phase 2: Local Memo MVP

- Implement local memo model.
- Implement sticky memo UI.
- Implement local SQLite adapter.
- Implement create, edit, hide, delete, restore, move, and resize.

### Phase 3: Windows Desktop Shell

- Implement system tray icon and double-click behavior.
- Implement tray menu.
- Implement startup registration setting.
- Implement Windows packaging.

### Phase 4: Backup

- Implement Google login.
- Implement Firestore backup and restore.
- Implement `.txt` export.
- Add backup status UI and failure handling.

### Phase 5: Hardening

- Add emulator rules tests.
- Add desktop smoke tests.
- Add release checklist.
- Produce a Windows installer artifact.

### Phase 6: Web Expansion

- Add `apps/web`.
- Reuse `memo-core`, `memo-ui`, and `memo-sync`.
- Replace desktop SQLite adapter with IndexedDB adapter.
- Add PWA install support.

## 14. Acceptance Criteria

The MVP is complete when:

- A Windows user can install and run the app.
- The app appears in the system tray.
- Double-clicking the tray icon opens a sticky memo.
- Notes autosave locally.
- User can create and manage multiple notes.
- User can change note background color, font, font size, and text color.
- User can enable startup registration.
- User can export memo contents as `.txt`.
- User can sign in with Google and back up notes to the server.
- Restore does not destroy local data on failed or invalid backup payloads.
- A Windows installer artifact is produced and smoke-tested.

## 15. Current Decisions

- Start with Windows desktop app.
- Use TypeScript/React as the product center.
- Use Tauri 2 as the desktop shell.
- Use Firebase Auth and Firestore for backup.
- Use local-first storage.
- Treat cross-device sync as future work, but design the package boundaries for it now.
- Use system tray icon, not an on-screen floating launcher, as the lower-right shortcut.
