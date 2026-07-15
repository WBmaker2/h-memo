import { validateBackupPayload, type Memo } from "@h-memo/memo-core";
import { validateLegacyFirestoreV1Payload } from "./legacyBackupPayload";
import {
  effectiveSchemaV2Time,
  parseBackupSnapshotSummary,
} from "./backupSnapshotSummary";
import type {
  BackupSnapshotPageRequest,
  BackupSnapshotSummary,
  BackupSnapshotSummaryPage,
  StoredBackupSnapshot,
} from "./backupTypes";
import type { DriverDocumentSnapshot } from "./firestoreBackupDriver";
import {
  BACKUP_COLLECTIONS,
  activationDoc,
  activeSnapshotIdFromState,
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

export async function listFirestoreBackupSummaries(
  context: FirestoreBackupContext,
  userId: string
): Promise<BackupSnapshotSummary[]> {
  const snapshotDocs = await context.driver.getDocs(snapshotCollection(context, userId));
  return snapshotDocs.docs
    .filter((snapshot) => snapshot.data().userId === userId)
    .map((snapshot) => parseBackupSnapshotSummary(snapshot.id, snapshot.data()))
    .filter((summary): summary is BackupSnapshotSummary => summary !== null);
}

export async function listFirestoreBackupSummaryPage(
  context: FirestoreBackupContext,
  userId: string,
  request: BackupSnapshotPageRequest,
): Promise<BackupSnapshotSummaryPage> {
  const cursorSnapshot = request.cursor?.kind === "firestore"
    ? request.cursor.snapshot as DriverDocumentSnapshot
    : undefined;
  const querySnapshot = await context.driver.getDocsPage(
    snapshotCollection(context, userId),
    {
      limit: request.limit + 1,
      savedAtFrom: new Date(request.savedAtFrom),
      savedAtTo: new Date(request.savedAtTo),
      startAfter: cursorSnapshot,
    },
  );
  const pageDocuments = querySnapshot.docs.slice(0, request.limit);
  const summaries = pageDocuments
    .filter((snapshot) => snapshot.data().userId === userId)
    .map((snapshot) => parseBackupSnapshotSummary(snapshot.id, snapshot.data()))
    .filter((summary): summary is BackupSnapshotSummary => summary !== null);
  const lastDocument = pageDocuments.at(-1);

  return {
    summaries,
    nextCursor:
      querySnapshot.docs.length > request.limit && lastDocument
        ? { kind: "firestore", snapshot: lastDocument }
        : null,
  };
}

export async function loadFirestoreBackup(
  context: FirestoreBackupContext,
  userId: string,
  snapshotId: string
): Promise<unknown | null> {
  const snapshot = await context.driver.getDoc(
    context.driver.doc(snapshotCollection(context, userId), snapshotId)
  );
  if (!snapshot.exists() || snapshot.data().userId !== userId) return null;
  return loadStoredSnapshot(context, snapshot, userId);
}

export async function loadCompleteSchemaV2Snapshot(
  context: FirestoreBackupContext,
  snapshot: DriverDocumentSnapshot,
  userId: string
): Promise<StoredBackupSnapshot | null> {
  if (snapshot.exists() && snapshot.data().schemaVersion === 3) {
    return loadCompleteSchemaV3Snapshot(context, snapshot, userId);
  }
  return loadCompleteSchemaSnapshot(context, snapshot, userId, 2);
}

export async function loadCompleteSchemaV3Snapshot(
  context: FirestoreBackupContext,
  snapshot: DriverDocumentSnapshot,
  userId: string
): Promise<StoredBackupSnapshot | null> {
  return loadCompleteSchemaSnapshot(context, snapshot, userId, 3);
}

async function loadCompleteSchemaSnapshot(
  context: FirestoreBackupContext,
  snapshot: DriverDocumentSnapshot,
  userId: string,
  schemaVersion: 2 | 3
): Promise<StoredBackupSnapshot | null> {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const savedAt = schemaVersion === 2
    ? effectiveSchemaV2Time(data)
    : normalizeFirestoreTimestamp(data.savedAt);
  const createdAt = schemaVersion === 3 ? data.clientCreatedAt : data.createdAt;
  if (
    data.schemaVersion !== schemaVersion ||
    data.state !== "complete" ||
    data.userId !== userId ||
    typeof createdAt !== "string" ||
    typeof data.memoCount !== "number" ||
    !Number.isInteger(data.memoCount) ||
    data.memoCount < 0 ||
    savedAt === null
  ) {
    return null;
  }

  const currentMemoDocs = await context.driver.getDocs(
    context.driver.collection(
      snapshot.ref,
      schemaVersion === 3 ? BACKUP_COLLECTIONS.snapshotV3 : BACKUP_COLLECTIONS.snapshotV2
    )
  );
  const legacyMemoDocs = schemaVersion === 2
    ? await context.driver.getDocs(
        context.driver.collection(snapshot.ref, BACKUP_COLLECTIONS.snapshotLegacy)
      )
    : { docs: [], empty: true };
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
      (schemaVersion === 3 && memo.deletedAt !== null) ||
      seenMemoIds.has(memoId)
    ) {
      return null;
    }
    seenMemoIds.add(memoId);
    memos.push(memo);
  }

  const parsed = validateBackupPayload(
    { version: 1, userId, createdAt, memos },
    userId
  );
  if (!parsed.ok) return null;

  return {
    id: snapshot.id,
    payload: schemaVersion === 2 ? { ...parsed.payload, createdAt: savedAt } : parsed.payload,
    savedAt,
  };
}

async function loadStoredSnapshot(
  context: FirestoreBackupContext,
  snapshot: DriverDocumentSnapshot,
  userId: string
): Promise<StoredBackupSnapshot | null> {
  const data = snapshot.data();
  if (data.schemaVersion === 3) {
    return loadCompleteSchemaV3Snapshot(context, snapshot, userId);
  }
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

export async function loadActiveSnapshotSummary(
  context: FirestoreBackupContext,
  userId: string
): Promise<BackupSnapshotSummary | null> {
  const state = await context.driver.getDoc(activationDoc(context, userId));
  if (state.exists() && state.data().userId !== userId) {
    throw new Error("Backup state belongs to a different user");
  }
  const snapshotId = activeSnapshotIdFromState(state);
  return snapshotId === null ? null : loadSnapshotSummaryById(context, userId, snapshotId);
}

export async function loadSnapshotSummaryById(
  context: FirestoreBackupContext,
  userId: string,
  snapshotId: string
): Promise<BackupSnapshotSummary | null> {
  const snapshot = await context.driver.getDoc(
    context.driver.doc(snapshotCollection(context, userId), snapshotId)
  );
  if (!snapshot.exists() || snapshot.data().userId !== userId) return null;
  return parseBackupSnapshotSummary(snapshot.id, snapshot.data());
}
