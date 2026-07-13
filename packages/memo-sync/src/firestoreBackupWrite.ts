import { type Memo } from "@h-memo/memo-core";
import type { MemoBackupPayload } from "./backupTypes";
import { encodeMemoDocumentId } from "./memoDocumentId";
import {
  activeSnapshotIdFromState,
  activatedAtFromState,
  activationDoc,
  assertPendingSnapshotLease,
  assertUniqueActiveMemoIds,
  assertValidNewBackupPayload,
  canonicalReferenceData,
  canonicalReferenceForSnapshot,
  canonicalMemoDocCandidates,
  chunkMemos,
  isRecord,
  isStoredCanonicalMemoFor,
  snapshotCollection,
  type CanonicalMemoCandidate,
  type CanonicalReference,
  type FirestoreBackupContext,
} from "./firestoreBackupShared";
import { BACKUP_COLLECTIONS } from "./firestoreBackupShared";

export async function saveFirestoreBackup(
  context: FirestoreBackupContext,
  userId: string,
  payload: MemoBackupPayload
): Promise<string> {
  if (isRecord(payload) && Array.isArray(payload.memos)) {
    assertUniqueActiveMemoIds(
      payload.memos.filter(
        (memo): memo is Memo => isRecord(memo) && memo.deletedAt === null
      )
    );
  }
  payload = assertValidNewBackupPayload(payload, userId);
  const activeMemos = payload.memos.filter((memo) => memo.deletedAt === null);
  const snapshotRef = context.driver.doc(snapshotCollection(context, userId));
  const snapshotId = context.driver.id(snapshotRef);

  const activeSnapshotId = await context.driver.runTransaction(
    context.firestore,
    async (transaction) => {
      const activeState = await transaction.get(activationDoc(context, userId));
      if (activeState.exists() && activeState.data().userId !== userId) {
        throw new Error("Backup state belongs to a different user");
      }

      const priorActiveSnapshotId = activeSnapshotIdFromState(activeState);
      transaction.set(snapshotRef, {
        schemaVersion: 2,
        userId,
        createdAt: payload.createdAt,
        memoCount: activeMemos.length,
        state: "writing",
      });
      transaction.set(activationDoc(context, userId), {
        userId,
        activeSnapshotId: priorActiveSnapshotId,
        pendingSnapshotId: snapshotId,
        activatedAt: activatedAtFromState(activeState),
      });
      return priorActiveSnapshotId;
    }
  );

  for (const memoChunk of chunkMemos(activeMemos)) {
    await context.driver.runTransaction(context.firestore, async (transaction) => {
      assertPendingSnapshotLease(
        await transaction.get(activationDoc(context, userId)),
        userId,
        snapshotId
      );

      const canonicalMemos = await Promise.all(
        memoChunk.map(async (memo) => {
          const candidates = canonicalMemoDocCandidates(context, userId, memo.id);
          const snapshots = await Promise.all(
            candidates.map((candidate) => transaction.get(candidate.ref))
          );
          const entries: CanonicalMemoCandidate[] = candidates.map((candidate, index) => ({
            ref: candidate.ref,
            snapshot: snapshots[index]!,
            isLegacy: candidate.isLegacy,
          }));
          let previousActiveReference: CanonicalReference | null = null;
          if (activeSnapshotId) {
            for (const entry of entries) {
              if (!isStoredCanonicalMemoFor(entry.snapshot, userId, memo.id, entry.isLegacy)) {
                continue;
              }
              const reference = canonicalReferenceForSnapshot(
                entry.snapshot.data(),
                activeSnapshotId
              );
              if (reference) {
                previousActiveReference = reference;
                break;
              }
            }
          }
          return {
            primary: entries[0]!,
            existing: entries.filter((entry) =>
              isStoredCanonicalMemoFor(entry.snapshot, userId, memo.id, entry.isLegacy)
            ),
            previousActiveReference,
          };
        })
      );

      for (const [index, memo] of memoChunk.entries()) {
        const canonicalMemo = canonicalMemos[index]!;
        const stagedReferences = {
          active: canonicalReferenceData(canonicalMemo.previousActiveReference),
          pending: {
            snapshotId,
            savedAt: context.driver.serverTimestamp(),
          },
        };

        if (canonicalMemo.primary.snapshot.exists()) {
          if (
            !isStoredCanonicalMemoFor(
              canonicalMemo.primary.snapshot,
              userId,
              memo.id,
              canonicalMemo.primary.isLegacy
            )
          ) {
            throw new Error(`Canonical memo document does not match memo ID: ${memo.id}`);
          }
          transaction.update(canonicalMemo.primary.ref, stagedReferences);
        } else {
          transaction.set(canonicalMemo.primary.ref, {
            userId,
            memoId: memo.id,
            ...stagedReferences,
          });
        }
        transaction.set(
          context.driver.doc(snapshotRef, BACKUP_COLLECTIONS.snapshotV2, encodeMemoDocumentId(memo.id)),
          { userId, memoId: memo.id, memo }
        );
      }
    });
  }

  await context.driver.runTransaction(context.firestore, async (transaction) => {
    const activationState = await transaction.get(activationDoc(context, userId));
    assertPendingSnapshotLease(activationState, userId, snapshotId);
    const snapshot = await transaction.get(snapshotRef);
    if (
      !snapshot.exists() ||
      snapshot.data().schemaVersion !== 2 ||
      snapshot.data().userId !== userId ||
      snapshot.data().state !== "writing"
    ) {
      throw new Error(`Backup ${snapshotId} is no longer writable`);
    }

    transaction.update(snapshotRef, {
      state: "complete",
      savedAt: context.driver.serverTimestamp(),
    });
    transaction.set(activationDoc(context, userId), {
      userId,
      activeSnapshotId: snapshotId,
      pendingSnapshotId: null,
      activatedAt: context.driver.serverTimestamp(),
    });
  });

  return `${(snapshotRef as { path?: string }).path ?? `users/${userId}/${BACKUP_COLLECTIONS.snapshots}/${snapshotId}`}`;
}
