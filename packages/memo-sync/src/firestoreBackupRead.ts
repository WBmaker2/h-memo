import { validateBackupPayload, type Memo } from "@h-memo/memo-core";
import { validateLegacyFirestoreV1Payload } from "./legacyBackupPayload";
import type { StoredBackupSnapshot } from "./backupTypes";
import type { DriverDocumentSnapshot } from "./firestoreBackupDriver";
import {
  BACKUP_COLLECTIONS,
  isMemoDocumentForPath,
  normalizeFirestoreTimestamp,
  snapshotCollection,
  type FirestoreBackupContext,
} from "./firestoreBackupShared";

function isValidMemo(memo: unknown, userId: string): memo is Memo {
  return validateBackupPayload(
    {
      version: 1,
      userId,
      createdAt: "1970-01-01T00:00:00.000Z",
      memos: [memo],
    },
    userId
  ).ok;
}

export async function loadLatestFirestoreBackup(
  context: FirestoreBackupContext,
  userId: string
): Promise<unknown | null> {
  return (await loadAllFirestoreBackups(context, userId))[0] ?? null;
}

export async function loadAllFirestoreBackups(
  context: FirestoreBackupContext,
  userId: string
): Promise<unknown[]> {
  const snapshotDocs = await context.driver.getDocs(snapshotCollection(context, userId));
  const storedSnapshots = await Promise.all(
    snapshotDocs.docs.map((snapshot) => loadStoredSnapshot(context, snapshot, userId))
  );
  return sortStoredSnapshots(
    storedSnapshots.filter(
      (snapshot): snapshot is StoredBackupSnapshot => snapshot !== null
    )
  );
}

export async function loadCompleteSchemaV2Snapshot(
  context: FirestoreBackupContext,
  snapshot: DriverDocumentSnapshot,
  userId: string
): Promise<StoredBackupSnapshot | null> {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const savedAt = normalizeFirestoreTimestamp(data.savedAt);
  if (
    data.schemaVersion !== 2 ||
    data.state !== "complete" ||
    data.userId !== userId ||
    typeof data.createdAt !== "string" ||
    typeof data.memoCount !== "number" ||
    !Number.isInteger(data.memoCount) ||
    data.memoCount < 0 ||
    savedAt === null
  ) {
    return null;
  }

  const [currentMemoDocs, legacyMemoDocs] = await Promise.all([
    context.driver.getDocs(context.driver.collection(snapshot.ref, BACKUP_COLLECTIONS.snapshotV2)),
    context.driver.getDocs(context.driver.collection(snapshot.ref, BACKUP_COLLECTIONS.snapshotLegacy)),
  ]);
  const memoDocs = [
    ...currentMemoDocs.docs.map((memoSnapshot) => ({ memoSnapshot, isLegacy: false })),
    ...legacyMemoDocs.docs.map((memoSnapshot) => ({ memoSnapshot, isLegacy: true })),
  ];
  if (memoDocs.length !== data.memoCount) return null;

  const memos: Memo[] = [];
  const seenMemoIds = new Set<string>();
  for (const { memoSnapshot, isLegacy } of memoDocs) {
    const wrapper = memoSnapshot.data();
    const memo = wrapper.memo;
    const memoId = wrapper.memoId;
    if (
      wrapper.userId !== userId ||
      typeof memoId !== "string" ||
      !isMemoDocumentForPath(memoSnapshot.id, memoId, isLegacy) ||
      !isValidMemo(memo, userId) ||
      memo.id !== memoId ||
      seenMemoIds.has(memoId)
    ) {
      return null;
    }
    seenMemoIds.add(memoId);
    memos.push(memo);
  }

  const parsed = validateBackupPayload(
    { version: 1, userId, createdAt: data.createdAt, memos },
    userId
  );
  if (!parsed.ok) return null;

  return { id: snapshot.id, payload: parsed.payload, savedAt };
}

async function loadStoredSnapshot(
  context: FirestoreBackupContext,
  snapshot: DriverDocumentSnapshot,
  userId: string
): Promise<StoredBackupSnapshot | null> {
  const data = snapshot.data();
  if (data.schemaVersion === 2) {
    return loadCompleteSchemaV2Snapshot(context, snapshot, userId);
  }

  const parsed = validateLegacyFirestoreV1Payload(data, userId);
  if (!parsed.ok) return null;
  return {
    id: snapshot.id,
    payload: parsed.payload,
    savedAt: normalizeFirestoreTimestamp(data.savedAt) ?? parsed.payload.createdAt,
    source: "firestore-v1",
  };
}

export function sortStoredSnapshots(snapshots: StoredBackupSnapshot[]) {
  return [...snapshots].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
