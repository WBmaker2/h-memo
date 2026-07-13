# H Memo Final Review Fix 2

Date: 2026-07-13
Branch: `codex/h-memo-hardening-v1`
Base: `627dc56`

## Important A: Legacy ID Collision

- New writes use the isolated `memosV2`, snapshot `memosV2`, and
  `serverMemoDeletesV2` namespaces.
- The codec keeps round-trip coverage for raw-safe, reserved-prefix, unsafe,
  Unicode, slash, empty, and edge IDs.
- Legacy raw documents remain readable by exact stored-ID matching. A legacy
  path that only matches the codec interpretation is rejected, so
  `memo~003f` cannot be treated as `?`.
- New canonical writes and reads require the encoded primary path to match the
  stored `memoId`; mismatches are ignored or rejected before update.
- Firestore policy assertions keep legacy memo paths read-only and constrain
  new writes to the versioned namespaces.

## Important B: Legacy v1 Timestamp Normalization

- Empty or non-parseable legacy timestamps use the deterministic fallback
  `1970-01-01T00:00:00.000Z` after trying payload and memo timestamps.
- Parseable timestamps are converted to canonical UTC ISO strings.
- Missing `createdAt` falls back to `updatedAt`, missing `updatedAt` falls back
  to `createdAt`, and `updatedAt` is clamped to `createdAt` when ordering is
  invalid.
- Restored payloads are checked by strict v2 validation and covered for
  immediate re-backup and restore safety-point creation. New v2 writes still
  fail preflight on invalid timestamps.

## TDD Evidence

- RED: the new legacy collision test returned the incorrectly loaded `?`
  memo; the ordering test returned `updatedAt` before `createdAt`.
- GREEN: focused suite passed with 5 files and 55 tests.

## Verification

- `npm test -- --pool=forks`: 49 files, 422 tests passed.
- `npm run typecheck`: passed for all workspaces.
- `npm run build`: passed for desktop and web. Existing bundle-size warnings
  remain.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline`:
  34 passed, 0 failed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --offline -- -D warnings`:
  passed.
- `npm test -- --pool=forks scripts/firestore-rules-policy.test.ts`: 7 tests
  passed.
- `git diff --check`: passed.

## Remaining Limitations

- Firestore rules statically validate the encoded-ID shape and namespace, but
  cannot decode UTF-16 IDs to prove the exact original value at rules runtime.
- Existing build bundle-size warnings are outside this fix scope.
