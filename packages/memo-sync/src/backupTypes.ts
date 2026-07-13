import type { BackupPayload, Memo } from "@h-memo/memo-core";

export type MemoBackupPayload = BackupPayload;

export type StoredBackupSnapshot = {
  id: string;
  payload: MemoBackupPayload;
  savedAt: string;
  source?: "firestore-v1";
};

export type StoredCurrentMemo = {
  memo: Memo;
  savedAt: string;
  snapshotId: string;
};

export type BackedUpMemo = {
  memo: Memo;
  backupCreatedAt: string;
};

export type BackedUpSnapshot = {
  createdAt: string;
  memoCount: number;
  payload: MemoBackupPayload;
};

export type BackupSchemaVersion = 1 | 2 | 3;

export type BackupSnapshotSummary = {
  id: string;
  savedAt: string | null;
  kstDate: string | null;
  memoCount: number;
  previewText: string;
  contentHash: string | null;
  schemaVersion: BackupSchemaVersion;
  state: "complete";
  legacyUndated: boolean;
};

export type BackupCleanupCandidate = {
  id: string;
  schemaVersion: BackupSchemaVersion;
  savedAt: string;
  kstDate: string;
  reason: "same-day-duplicate" | "expired";
};

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
  loadBackups(userId: string): Promise<unknown[]>;
  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}
