import type { Memo } from "@h-memo/memo-core";

export const WEB_AUTO_BACKUP_IDLE_MS = 10_000;

export function createWebMemoFingerprint(memos: Memo[]): string {
  return JSON.stringify([...memos].sort((a, b) => a.id.localeCompare(b.id)));
}

export function hasWebBackupConflict(
  observedSnapshotId: string | null,
  latestSnapshotId: string | null
): boolean {
  return observedSnapshotId !== latestSnapshotId;
}
