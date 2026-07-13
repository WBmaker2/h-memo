import {
  createBackupPayload as createMemoBackupPayload,
  validateBackupPayload,
  type Memo,
} from "@h-memo/memo-core";
import { validateLegacyFirestoreV1Payload } from "./legacyBackupPayload";
import {
  isRecord,
  normalizeFirestoreTimestamp,
} from "./firestoreBackupShared";
import type {
  BackedUpMemo,
  BackedUpSnapshot,
  BackupGateway,
  MemoBackupPayload,
  StoredBackupSnapshot,
} from "./backupTypes";

export {
  FirestoreBackupGateway,
} from "./firestoreBackupGateway";
export {
  canUseLegacyRawMemoDocumentId,
  decodeMemoDocumentId,
  encodeMemoDocumentId,
  isMemoDocumentIdFor,
} from "./memoDocumentId";
export type {
  BackedUpMemo,
  BackedUpSnapshot,
  BackupGateway,
  MemoBackupPayload,
  StoredBackupSnapshot,
  StoredCurrentMemo,
} from "./backupTypes";
export type { FirestoreBackupDriver } from "./firestoreBackupDriver";

function isIncompleteSchemaV2Snapshot(value: unknown) {
  return isRecord(value) && value.schemaVersion === 2 && value.state !== "complete";
}

function toStoredBackupSnapshot(
  value: unknown,
  userId: string
): StoredBackupSnapshot | null {
  if (isIncompleteSchemaV2Snapshot(value)) return null;

  const record = isRecord(value) ? value : null;
  const payloadValue = record && "payload" in record ? record.payload : value;
  const parsed =
    record?.source === "firestore-v1"
      ? validateLegacyFirestoreV1Payload(payloadValue, userId)
      : validateBackupPayload(payloadValue, userId);
  if (!parsed.ok) throw new Error(parsed.reason);

  return {
    id: typeof record?.id === "string" ? record.id : "",
    payload: parsed.payload,
    savedAt: normalizeFirestoreTimestamp(record?.savedAt) ?? parsed.payload.createdAt,
  };
}

async function loadStoredBackupSnapshots(
  gateway: BackupGateway,
  userId: string
): Promise<StoredBackupSnapshot[]> {
  const snapshots = (await gateway.loadBackups(userId))
    .map((snapshot) => toStoredBackupSnapshot(snapshot, userId))
    .filter((snapshot): snapshot is StoredBackupSnapshot => snapshot !== null);
  return [...snapshots].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function loadDeletedMemoIdSet(gateway: BackupGateway, userId: string) {
  return gateway.loadDeletedMemoIds(userId).then((ids) => new Set(ids));
}

function filterDeletedServerMemos(payload: MemoBackupPayload, deletedMemoIds: Set<string>) {
  if (deletedMemoIds.size === 0) return payload;
  return { ...payload, memos: payload.memos.filter((memo) => !deletedMemoIds.has(memo.id)) };
}

export async function backupMemos(
  gateway: BackupGateway,
  userId: string,
  memos: Memo[],
  now = new Date().toISOString()
): Promise<{ path: string; payload: MemoBackupPayload }> {
  const payload = createMemoBackupPayload({ userId, memos, createdAt: now });
  const parsed = validateBackupPayload(payload, userId);
  if (!parsed.ok) throw new Error(parsed.reason);
  const path = await gateway.saveBackup(userId, payload);
  return { path, payload };
}

export async function restoreLatestBackup(
  gateway: BackupGateway,
  userId: string
): Promise<MemoBackupPayload | null> {
  const latest = (await loadStoredBackupSnapshots(gateway, userId))[0];
  if (!latest) return null;
  return filterDeletedServerMemos(latest.payload, await loadDeletedMemoIdSet(gateway, userId));
}

export async function listBackedUpMemos(
  gateway: BackupGateway,
  userId: string
): Promise<BackedUpMemo[]> {
  const [memos, deletedMemoIds] = await Promise.all([
    gateway.loadCurrentMemos(userId),
    loadDeletedMemoIdSet(gateway, userId),
  ]);
  return memos
    .filter((entry) => entry.memo.deletedAt === null && !deletedMemoIds.has(entry.memo.id))
    .map((entry) => ({ memo: entry.memo, backupCreatedAt: entry.savedAt }))
    .sort((a, b) => b.backupCreatedAt.localeCompare(a.backupCreatedAt));
}

export async function listBackupSnapshots(
  gateway: BackupGateway,
  userId: string
): Promise<BackedUpSnapshot[]> {
  const [backups, deletedMemoIds] = await Promise.all([
    loadStoredBackupSnapshots(gateway, userId),
    loadDeletedMemoIdSet(gateway, userId),
  ]);
  return backups.map((backup) => {
    const payload = filterDeletedServerMemos(backup.payload, deletedMemoIds);
    return { createdAt: backup.savedAt, memoCount: payload.memos.length, payload };
  });
}

export async function deleteBackedUpMemo(
  gateway: BackupGateway,
  userId: string,
  memoId: string
): Promise<number> {
  return gateway.deleteCurrentMemo(userId, memoId);
}
