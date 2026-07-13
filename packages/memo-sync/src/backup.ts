import {
  createBackupPayload as createMemoBackupPayload,
  validateBackupPayload,
  type Memo,
} from "@h-memo/memo-core";
import { validateLegacyFirestoreV1Payload } from "./legacyBackupPayload";
import { isRecord, normalizeFirestoreTimestamp } from "./firestoreBackupShared";
import { selectDailyBackupSummaries } from "./backupRetention";
import type {
  BackedUpMemo,
  BackedUpSnapshot,
  BackupSaveResult,
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
  BackupSaveResult,
  BackupWriteOutcome,
  MemoBackupPayload,
  StoredBackupSnapshot,
  StoredCurrentMemo,
} from "./backupTypes";
export type { FirestoreBackupDriver } from "./firestoreBackupDriver";
export type { BackupSnapshotSummary } from "./backupTypes";

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

export async function listBackupSnapshotSummaries(
  gateway: BackupGateway,
  userId: string,
  now = new Date().toISOString()
) {
  return selectDailyBackupSummaries(await gateway.listBackupSummaries(userId), now);
}

export async function loadBackupSnapshot(
  gateway: BackupGateway,
  userId: string,
  snapshotId: string
): Promise<MemoBackupPayload | null> {
  const stored = await gateway.loadBackup(userId, snapshotId);
  if (stored === null) return null;
  const parsed = toStoredBackupSnapshot(stored, userId);
  if (!parsed) return null;
  const deletedMemoIds = await loadDeletedMemoIdSet(gateway, userId);
  return filterDeletedServerMemos(parsed.payload, deletedMemoIds);
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
): Promise<BackupSaveResult & { payload: MemoBackupPayload }> {
  const payload = createMemoBackupPayload({ userId, memos, createdAt: now });
  const parsed = validateBackupPayload(payload, userId);
  if (!parsed.ok) throw new Error(parsed.reason);
  const saved = await gateway.saveBackup(userId, payload);
  return { ...saved, payload };
}

export async function restoreLatestBackup(
  gateway: BackupGateway,
  userId: string
): Promise<MemoBackupPayload | null> {
  const latest = (await listBackupSnapshotSummaries(gateway, userId))[0];
  return latest === undefined ? null : loadBackupSnapshot(gateway, userId, latest.id);
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
  const summaries = [...(await gateway.listBackupSummaries(userId))].sort(
    (left, right) => (right.savedAt ?? "").localeCompare(left.savedAt ?? "")
  );
  const backups = await Promise.all(
    summaries.map(async (summary) => {
      const payload = await loadBackupSnapshot(gateway, userId, summary.id);
      return payload === null
        ? null
        : { createdAt: summary.savedAt ?? payload.createdAt, memoCount: payload.memos.length, payload };
    })
  );
  return backups.filter((backup): backup is BackedUpSnapshot => backup !== null);
}

export async function deleteBackedUpMemo(
  gateway: BackupGateway,
  userId: string,
  memoId: string
): Promise<number> {
  return gateway.deleteCurrentMemo(userId, memoId);
}
