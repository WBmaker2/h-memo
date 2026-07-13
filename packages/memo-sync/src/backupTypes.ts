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

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
  loadBackups(userId: string): Promise<unknown[]>;
  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}
