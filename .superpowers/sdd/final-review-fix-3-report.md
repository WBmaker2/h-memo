# H Memo Final Review Fix 3

Date: 2026-07-13
Branch: `codex/h-memo-hardening-v1`
Base: `2053377`

## Important: v2 Rebackup Tombstone Cleanup

- The v2 backup activation transaction now reads tombstones for active memo IDs
  and deletes only the `serverMemoDeletesV2` documents that exist in that same
  transaction.
- Tombstone cleanup happens together with the `writing` to `complete` snapshot
  transition and active-generation switch. A failed or superseded backup cannot
  remove a tombstone before activation.
- The legacy `serverMemoDeletes` read path and compatibility behavior are
  unchanged.
- The Firestore driver and fake adapter now expose transaction deletes so the
  atomic operation is covered by the adapter contract.

## TDD Evidence

- RED: the new same-ID v2 rebackup test failed because the tombstone remained
  after activation; the failure was at
  `packages/memo-sync/src/backup.test.ts:846`.
- GREEN: the focused `backup.test.ts` suite passed with 34/34 tests after the
  minimal transaction cleanup implementation.
- The added failed-activation test confirms that a same-ID tombstone remains
  when activation fails before the new generation becomes active.

## Verification

- `npm test -- --pool=forks`: 49 files, 424 tests passed.
- `npm run typecheck`: passed for all workspaces.
- `npm run build`: desktop and web builds passed. Existing bundle-size warnings
  remain for the generated JavaScript chunks over 500 kB.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline`:
  34 passed, 0 failed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --offline -- -D warnings`:
  passed.
- `npm test -- --pool=forks scripts/firestore-rules-policy.test.ts`: 7 tests
  passed.
- `git diff --check`: passed.

## Remaining Limitations

- The existing build chunk-size warnings are outside this focused tombstone fix.
- Verification used the repository fake Firestore driver and static rules tests;
  no real Firebase or user data was accessed or mutated.
