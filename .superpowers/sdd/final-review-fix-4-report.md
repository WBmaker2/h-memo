# Final Review Fix 4 Report

Date: 2026-07-13
Branch: `codex/h-memo-hardening-v1`

## Scope

Fixed the Important final-review finding in `packages/memo-sync/src/backup.ts`:

- Final activation no longer reads or deletes every active memo tombstone.
- V2 tombstones are scoped to `snapshotId === activeSnapshotId` when restore/list filtering is performed.
- A successful backup that activates a newer snapshot logically supersedes stale V2 tombstones without physical cleanup.
- Failed or incomplete backups leave `activeSnapshotId` unchanged, so their tombstones remain effective.
- Legacy tombstones retain compatibility behavior; an existing active canonical memo prevents a legacy tombstone from hiding it.

The plan document now describes generation-based supersession instead of physical tombstone clearing.

## TDD Evidence

### RED

Added a fake Firestore transaction read/write counter with a 500 read/write limit and a regression test covering 501 active memos plus 501 tombstones.

Focused command:

```text
npm test -- --pool=forks packages/memo-sync/src/backup.test.ts
```

The first RED run observed `35 tests | 2 failed`: the old implementation exceeded the default cap at `503 reads` before the 501 tombstones could be created, and the updated supersession expectation observed a physically deleted tombstone. The regression guard then relaxes only the setup read cap so the 501 tombstones are created; against the old final activation this reaches `503 reads / 503 writes`, while the fixed implementation stays at `401 reads / 400 writes`.

### GREEN

The focused suite passes with `35/35` tests. The large re-backup regression confirms that all 501 memos are present in current memos, latest restore, and current list results while the old-generation tombstone remains stored but is no longer applied.

## Transaction Bound

The fake driver observed a maximum of:

- `401 reads` per transaction
- `400 writes` per transaction

The maximum comes from a 200-memo staging chunk: one activation-state read plus two canonical candidate reads per memo, and two writes per memo. Final activation is now bounded at two reads and two writes and does not enumerate tombstones.

## Verification Gates

- `npm test -- --pool=forks`: passed, `49` files / `425` tests
- `npm run typecheck`: passed for desktop, web, memo-core, memo-sync, and memo-ui
- `npm run build`: passed; existing bundle-size warnings remain
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline`: passed, `34` Rust tests
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --offline -- -D warnings`: passed
- `npm test -- --pool=forks scripts/firestore-rules-policy.test.ts`: passed, `7` tests
- `git diff --check`: passed

No real Firebase project or user data was accessed or mutated.

## Remaining Limitations

- Stale V2 tombstones are retained physically. Cleanup is intentionally omitted so activation success and restore semantics do not depend on an additional cleanup phase.
- Existing desktop and web production bundles still emit the pre-existing size warning.
