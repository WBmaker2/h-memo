import { validateBackupPayload, type Memo } from "@h-memo/memo-core";
import type { StoredCurrentMemo } from "./backupTypes";
import {
  BACKUP_COLLECTIONS,
  activationDoc,
  activeSnapshotIdFromState,
  canonicalMemoDocCandidates,
  canonicalReferenceData,
  canonicalReferenceForSnapshot,
  deletedMemoCollection,
  deletedMemoDoc,
  isMemoDocumentForPath,
  isStoredCanonicalMemoFor,
  legacyDeletedMemoDocs,
  normalizeFirestoreTimestamp,
  snapshotCollection,
  type FirestoreBackupContext,
} from "./firestoreBackupShared";
import { loadCompleteSchemaV2Snapshot } from "./firestoreBackupRead";

export async function loadFirestoreDeletedMemoIds(
  context: FirestoreBackupContext,
  userId: string
): Promise<string[]> {
  const [currentMemos, activeState, querySnapshot, legacyQuerySnapshot] = await Promise.all([
    loadFirestoreCurrentMemos(context, userId),
    context.driver.getDoc(activationDoc(context, userId)),
    context.driver.getDocs(deletedMemoCollection(context, userId)),
    context.driver.getDocs(legacyDeletedMemoDocs(context, userId)),
  ]);
  const activeSnapshotId = activeSnapshotIdFromState(activeState);
  const activeMemoIds = new Set(currentMemos.map((entry) => entry.memo.id));
  const seenMemoIds = new Set<string>();
  return [
    ...querySnapshot.docs.map((snapshot) => ({ snapshot, isLegacy: false })),
    ...legacyQuerySnapshot.docs.map((snapshot) => ({ snapshot, isLegacy: true })),
  ].flatMap(({ snapshot, isLegacy }) => {
    const data = snapshot.data();
    const memoId = data.memoId;
    if (
      data.userId !== userId ||
      typeof memoId !== "string" ||
      !isMemoDocumentForPath(snapshot.id, memoId, isLegacy) ||
      (!isLegacy && data.snapshotId !== activeSnapshotId) ||
      snapshot.id.trim() === "" ||
      activeMemoIds.has(memoId) ||
      seenMemoIds.has(memoId)
    ) {
      return [];
    }
    seenMemoIds.add(memoId);
    return [memoId];
  });
}

export async function loadFirestoreCurrentMemos(
  context: FirestoreBackupContext,
  userId: string
): Promise<StoredCurrentMemo[]> {
  const activeSnapshotId = activeSnapshotIdFromState(
    await context.driver.getDoc(activationDoc(context, userId))
  );
  if (!activeSnapshotId) return [];

  const activeSnapshot = await loadCompleteSchemaV2Snapshot(
    context,
    await context.driver.getDoc(
      context.driver.doc(snapshotCollection(context, userId), activeSnapshotId)
    ),
    userId
  );
  if (!activeSnapshot) return [];

  const snapshotMemosById = new Map(
    activeSnapshot.payload.memos.map((memo) => [memo.id, memo])
  );
  const [currentMemoDocs, legacyMemoDocs] = await Promise.all([
    context.driver.getDocs(
      context.driver.collection(
        context.firestore,
        "users",
        userId,
        BACKUP_COLLECTIONS.canonicalV2
      )
    ),
    context.driver.getDocs(
      context.driver.collection(
        context.firestore,
        "users",
        userId,
        BACKUP_COLLECTIONS.snapshotLegacy
      )
    ),
  ]);
  const memoDocs = [
    ...currentMemoDocs.docs.map((memoSnapshot) => ({ memoSnapshot, isLegacy: false })),
    ...legacyMemoDocs.docs.map((memoSnapshot) => ({ memoSnapshot, isLegacy: true })),
  ];
  const currentMemos: StoredCurrentMemo[] = [];
  const seenMemoIds = new Set<string>();
  for (const { memoSnapshot, isLegacy } of memoDocs) {
    const data = memoSnapshot.data();
    const reference = canonicalReferenceForSnapshot(data, activeSnapshotId);
    const memoId = data.memoId;
    const memo = typeof memoId === "string" ? snapshotMemosById.get(memoId) : undefined;
    const savedAt = normalizeFirestoreTimestamp(reference?.savedAt);
    if (
      data.userId !== userId ||
      typeof memoId !== "string" ||
      !isMemoDocumentForPath(memoSnapshot.id, memoId, isLegacy) ||
      reference?.snapshotId !== activeSnapshotId ||
      !isValidMemo(memo, userId) ||
      memo.id !== memoId ||
      seenMemoIds.has(memoId) ||
      savedAt === null
    ) {
      continue;
    }
    seenMemoIds.add(memoId);
    currentMemos.push({ memo, savedAt, snapshotId: activeSnapshotId });
  }
  return currentMemos;
}

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

export async function deleteFirestoreCurrentMemo(
  context: FirestoreBackupContext,
  userId: string,
  memoId: string
): Promise<number> {
  return context.driver.runTransaction(context.firestore, async (transaction) => {
    const activeSnapshotId = activeSnapshotIdFromState(
      await transaction.get(activationDoc(context, userId))
    );
    if (!activeSnapshotId) return 0;

    const canonicalCandidates = canonicalMemoDocCandidates(context, userId, memoId);
    const canonicalSnapshots = await Promise.all(
      canonicalCandidates.map((candidate) => transaction.get(candidate.ref))
    );
    const matchingCanonicalMemos = canonicalSnapshots.flatMap((canonicalMemo, index) => {
      const candidate = canonicalCandidates[index]!;
      if (!isStoredCanonicalMemoFor(canonicalMemo, userId, memoId, candidate.isLegacy)) return [];
      const data = canonicalMemo.data();
      const active = readCanonicalReference(data.active);
      const pending = readCanonicalReference(data.pending);
      const activeMatches = active?.snapshotId === activeSnapshotId;
      const pendingMatches = pending?.snapshotId === activeSnapshotId;
      if (data.userId !== userId || data.memoId !== memoId || (!activeMatches && !pendingMatches)) {
        return [];
      }
      return [{
        ref: candidate.ref,
        active,
        pending,
        activeMatches,
        pendingMatches,
      }];
    });
    if (matchingCanonicalMemos.length === 0) return 0;

    transaction.set(deletedMemoDoc(context, userId, memoId), {
      userId,
      memoId,
      snapshotId: activeSnapshotId,
      deletedAt: context.driver.serverTimestamp(),
    });
    for (const canonicalMemo of matchingCanonicalMemos) {
      transaction.update(canonicalMemo.ref, {
        active: canonicalMemo.activeMatches ? null : canonicalReferenceData(canonicalMemo.active),
        pending: canonicalMemo.pendingMatches
          ? null
          : canonicalReferenceData(canonicalMemo.pending),
      });
    }
    return 1;
  });
}

function readCanonicalReference(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.snapshotId !== "string" || record.snapshotId === "") return null;
  return normalizeFirestoreTimestamp(record.savedAt) === null
    ? null
    : { snapshotId: record.snapshotId, savedAt: record.savedAt };
}
