# H Memo Korean Date-Time Locale Stability Fix

**Date:** 2026-07-13

## Root Cause

- The merged `main` runs tests with Node 24.13.1 and ICU 78.2 under `C.UTF-8`.
- `Date#toLocaleString("ko-KR")` returns an English `AM`/`PM` day-period token in that runtime, while the implementation worktree's Node 25.6.1 returns Korean `오전`/`오후`.
- UI copy and tests require stable Korean day-period labels, so delegating the final string entirely to runtime ICU makes behavior environment-dependent.

## Implementation

- Keep date validation and locale-aware ordering/punctuation in `formatDateTime`.
- Use `Intl.DateTimeFormat#formatToParts` and normalize only Korean day-period parts (`AM`/`PM` to `오전`/`오후`).
- Preserve non-Korean locale output and the existing invalid-date fallback.
- Limit code changes to the small shared date formatter and its focused test; do not add code to the large desktop/web app modules.

## Verification

- Reproduce the current failure with the focused formatter test on merged `main`.
- Run the focused memo UI and desktop/web timestamp tests.
- Run the complete TypeScript test suite, typecheck, production build, Rust tests, Clippy, and Firestore policy test.
- Confirm the merged `main` remains clean except for the user's existing untracked image assets.
