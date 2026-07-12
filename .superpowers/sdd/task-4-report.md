# Task 4 Report: Durable Restore Points And One-Step Undo

## Status

Complete. Task 4 changes are implemented in the assigned worktree. Task 2/3 sync gateway code was not modified.

## RED

Command:

```bash
npm test -- --pool=forks packages/memo-core/src/restoreSafety.test.ts packages/memo-ui/src/SettingsPanel.test.tsx apps/desktop/src/App.test.tsx apps/web/src/WebApp.test.tsx
```

Before production changes, the focused run failed as expected: 7 tests failed and 74 existing tests passed. The failures were caused by the missing restore-safety exports, missing SettingsPanel undo control, missing persisted safety point, and missing app undo flow.

## GREEN

The same focused command passed after implementation and final test additions:

- 4 test files passed
- 85 tests passed

The required typecheck also passed:

```bash
npm run typecheck
```

All five workspace typechecks passed, including production and test TypeScript configs for the web app.

Additional verification passed:

```bash
npm test -- --pool=forks
```

Result: 41 test files and 264 tests passed.

## Files

- `packages/memo-core/src/restoreSafety.ts`: shared `Storage` persistence contract, envelope validation, safe load, and clear behavior.
- `packages/memo-core/src/restoreSafety.test.ts`: valid round-trip, malformed data, and storage quota coverage.
- `packages/memo-core/src/index.ts`: exports the shared restore-safety API.
- `apps/desktop/src/App.tsx`: durable startup load, pre-restore snapshot, localized server confirmation, JSON/server restore integration, and undo flow.
- `apps/desktop/src/App.test.tsx`: desktop JSON/server safety ordering, soft-deleted memo capture, storage failure abort, undo success, and startup-related flow coverage.
- `apps/web/src/WebApp.tsx`: browser implementation of the same safety and undo behavior.
- `apps/web/src/WebApp.test.tsx`: web JSON/server safety ordering, storage failure abort, startup load/malformed handling, and failed-undo retention coverage.
- `packages/memo-ui/src/SettingsPanel.tsx`: `canUndoRestore` and `onUndoRestore` props plus `마지막 복원 되돌리기` control.
- `packages/memo-ui/src/MemoWorkspace.tsx`: forwards the new SettingsPanel props through the existing workspace boundary.
- `packages/memo-ui/src/SettingsPanel.test.tsx`: undo control rendering and callback coverage.

## Persistence And Error Behavior

- Exactly one key is used: `h-memo:restore-safety-v1`.
- The persisted shape is version 1 with `source`, envelope `createdAt`, and a validated version-1 `BackupPayload`.
- Both apps call `repository.listMemos()` after pending writes settle and before the replacement transaction. The captured list includes soft-deleted repository entries.
- Safety-point serialization and `Storage.setItem` errors throw a user-readable error. Replacement is not called when saving the point fails, so local memos remain unchanged.
- JSON confirmation text remains unchanged.
- Server snapshot restore now confirms with `toLocaleString("ko-KR")` backup time and memo count before mutation.
- Successful restore stores the point and exposes `마지막 복원 되돌리기`.
- Undo reuses the existing rollback-capable replacement path without saving a new safety point first. The key is cleared only after replacement succeeds; failed undo leaves the persisted point and control available.
- Startup loads only a valid persisted point. JSON parse, shape-validation, or storage-read failures return unavailable state without crashing.

## Warning Status

No warnings were emitted by the focused tests, full test suite, typecheck, or `git diff --check`. No unrelated Task 2/3 files were changed.

## Self-Review

- Confirmed both platform flows use the same storage key and shared core validator.
- Confirmed safety persistence occurs before the first replacement `saveMemo`/`softDeleteMemo` call, including the undo path's deliberate omission of safety overwrite.
- Confirmed the existing replacement rollback behavior remains intact; only an optional captured pre-restore list was added so the safety point and mutation use the same repository snapshot.
- Confirmed malformed persisted data is treated as unavailable and does not reach the UI callback.
- Confirmed the settings control is forwarded through `MemoWorkspace`, which is required because that boundary passes SettingsPanel props explicitly.

## Concerns

No blocking concerns remain. If a replacement transaction fails after the safety point itself was stored, the durable point is retained while the existing rollback-capable path attempts recovery; the UI only exposes undo after a successful restore. This preserves a recovery artifact without changing Task 2/3 rollback semantics.
