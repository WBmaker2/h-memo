import { parseBackupSnapshotSummary } from "./backupSnapshotSummary";
import { planBackupCleanupCandidates } from "./backupRetention";
import type { BackupSnapshotSummary } from "./backupTypes";
import {
  activationDoc,
  activeSnapshotIdFromState,
  BACKUP_COLLECTIONS,
  snapshotCollection,
  type FirestoreBackupContext,
} from "./firestoreBackupShared";

export const MAX_BACKUP_CLEANUP_DELETES = 400;
const SNAPSHOT_MEMO_COLLECTIONS = [
  BACKUP_COLLECTIONS.snapshotV3,
  BACKUP_COLLECTIONS.snapshotV2,
  BACKUP_COLLECTIONS.snapshotLegacy,
] as const;

export type FirestoreBackupCleanupResult = {
  deletedDocuments: number;
  pending: boolean;
};

async function loadAllSnapshotSummaries(
  context: FirestoreBackupContext,
  userId: string
): Promise<BackupSnapshotSummary[]> {
  const snapshots = await context.driver.getDocs(snapshotCollection(context, userId));
  return snapshots.docs.flatMap((snapshot) => {
    const summary = parseBackupSnapshotSummary(snapshot.id, snapshot.data());
    return summary === null ? [] : [summary];
  });
}

export async function cleanupFirestoreBackups(
  context: FirestoreBackupContext,
  userId: string,
  options: {
    now: string | Date;
    activeSnapshotId: string | null;
    pendingSnapshotId: string | null;
    maxDeletes?: number;
  }
): Promise<FirestoreBackupCleanupResult> {
  const maxDeletes = Math.max(
    0,
    Math.min(options.maxDeletes ?? MAX_BACKUP_CLEANUP_DELETES, MAX_BACKUP_CLEANUP_DELETES)
  );
  const summaries = await loadAllSnapshotSummaries(context, userId);

  // The write path may have acquired a newer lease after the caller formed its options.
  const currentState = await context.driver.getDoc(activationDoc(context, userId));
  if (currentState.exists() && currentState.data().userId !== userId) {
    throw new Error("Backup state belongs to a different user");
  }
  const stateExists = currentState.exists();
  const candidates = planBackupCleanupCandidates(summaries, {
    now: options.now,
    activeSnapshotId: stateExists
      ? activeSnapshotIdFromState(currentState)
      : options.activeSnapshotId,
    pendingSnapshotId: stateExists
      ? pendingSnapshotIdFromState(currentState)
      : options.pendingSnapshotId,
  });

  if (candidates.length === 0) return { deletedDocuments: 0, pending: false };
  if (maxDeletes === 0) return { deletedDocuments: 0, pending: true };

  const batch = context.driver.writeBatch(context.firestore);
  let deletedDocuments = 0;
  let pending = false;

  for (const candidate of candidates) {
    const snapshotRef = context.driver.doc(snapshotCollection(context, userId), candidate.id);
    const childDocuments = [];
    for (const collectionName of SNAPSHOT_MEMO_COLLECTIONS) {
      const children = await context.driver.getDocs(
        context.driver.collection(snapshotRef, collectionName)
      );
      childDocuments.push(...children.docs);
    }

    const remainingDeletes = maxDeletes - deletedDocuments;
    if (childDocuments.length + 1 > remainingDeletes) {
      for (const child of childDocuments.slice(0, remainingDeletes)) {
        batch.delete(child.ref);
      }
      deletedDocuments += Math.min(childDocuments.length, remainingDeletes);
      pending = true;
      break;
    }

    for (const child of childDocuments) batch.delete(child.ref);
    batch.delete(snapshotRef);
    deletedDocuments += childDocuments.length + 1;

    if (deletedDocuments === maxDeletes) {
      pending = candidates.at(-1)?.id !== candidate.id;
      break;
    }
  }

  if (deletedDocuments > 0) await batch.commit();
  return { deletedDocuments, pending };
}

function pendingSnapshotIdFromState(snapshot: { exists(): boolean; data(): Record<string, unknown> }) {
  if (!snapshot.exists()) return null;
  const value = snapshot.data().pendingSnapshotId;
  return typeof value === "string" && value !== "" ? value : null;
}
