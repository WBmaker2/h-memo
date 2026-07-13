import { type Memo } from "@h-memo/memo-core";
import { createBackupContentHash, createBackupPreviewText } from "./backupFingerprint";
import { toKstDateKey } from "./backupKstDate";
import type { BackupSaveResult, MemoBackupPayload } from "./backupTypes";
import { encodeMemoDocumentId } from "./memoDocumentId";
import {
  activeSchemaVersionFromState,
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
import {
  loadActiveSnapshotSummary,
  loadSnapshotSummaryById,
} from "./firestoreBackupRead";

function snapshotPath(context: FirestoreBackupContext, userId: string, snapshotId: string) {
  const ref = context.driver.doc(snapshotCollection(context, userId), snapshotId);
  return `${(ref as { path?: string }).path ?? `users/${userId}/${BACKUP_COLLECTIONS.snapshots}/${snapshotId}`}`;
}

export async function saveFirestoreBackup(
  context: FirestoreBackupContext,
  userId: string,
  payloadInput: MemoBackupPayload
): Promise<BackupSaveResult> {
  if (isRecord(payloadInput) && Array.isArray(payloadInput.memos)) {
    assertUniqueActiveMemoIds(
      payloadInput.memos.filter(
        (memo): memo is Memo => isRecord(memo) && memo.deletedAt === null
      )
    );
  }

  const payload = assertValidNewBackupPayload(payloadInput, userId);
  const activeMemos = payload.memos.filter((memo) => memo.deletedAt === null);
  assertUniqueActiveMemoIds(activeMemos);
  const contentHash = await createBackupContentHash(payload);
  const previewText = createBackupPreviewText(payload);
  const prior = await loadActiveSnapshotSummary(context, userId);
  const requestedDate = toKstDateKey(payload.createdAt);

  if (
    prior?.schemaVersion === 3 &&
    prior.kstDate !== null &&
    prior.kstDate === requestedDate &&
    prior.contentHash === contentHash
  ) {
    return {
      path: snapshotPath(context, userId, prior.id),
      snapshotId: prior.id,
      outcome: "unchanged",
      cleanupPending: false,
    };
  }

  const written = await writeAndActivateSchemaV3Snapshot(context, {
    userId,
    payload,
    activeMemos,
    contentHash,
    previewText,
  });
  const saved = await loadSnapshotSummaryById(context, userId, written.snapshotId);
  if (!saved?.kstDate) throw new Error("Completed backup is missing server savedAt");

  return {
    path: written.path,
    snapshotId: written.snapshotId,
    outcome: prior?.kstDate === saved.kstDate ? "replaced" : "created",
    cleanupPending: false,
  };
}

type SchemaV3WriteInput = {
  userId: string;
  payload: MemoBackupPayload;
  activeMemos: Memo[];
  contentHash: string;
  previewText: string;
};

async function writeAndActivateSchemaV3Snapshot(
  context: FirestoreBackupContext,
  input: SchemaV3WriteInput
) {
  const { userId, payload, activeMemos, contentHash, previewText } = input;
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
        schemaVersion: 3,
        userId,
        clientCreatedAt: payload.createdAt,
        memoCount: activeMemos.length,
        contentHash,
        previewText,
        state: "writing",
        savedAt: null,
      });
      transaction.set(activationDoc(context, userId), {
        userId,
        activeSnapshotId: priorActiveSnapshotId,
        activeSchemaVersion: activeSchemaVersionFromState(activeState),
        pendingSnapshotId: snapshotId,
        pendingSchemaVersion: 3,
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
          return { primary: entries[0]!, previousActiveReference };
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
          context.driver.doc(
            snapshotRef,
            BACKUP_COLLECTIONS.snapshotV3,
            encodeMemoDocumentId(memo.id)
          ),
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
      snapshot.data().schemaVersion !== 3 ||
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
      activeSchemaVersion: 3,
      pendingSnapshotId: null,
      pendingSchemaVersion: null,
      activatedAt: context.driver.serverTimestamp(),
    });
  });

  return {
    path: snapshotPath(context, userId, snapshotId),
    snapshotId,
  };
}
