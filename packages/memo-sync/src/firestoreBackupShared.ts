import type { Firestore } from "firebase/firestore";
import { validateBackupPayload, type Memo } from "@h-memo/memo-core";
import {
  canUseLegacyRawMemoDocumentId,
  encodeMemoDocumentId,
} from "./memoDocumentId";
import type { FirestoreBackupDriver, DriverDocumentSnapshot } from "./firestoreBackupDriver";
import type { MemoBackupPayload } from "./backupTypes";

export type FirestoreBackupContext = {
  firestore: Firestore;
  driver: FirestoreBackupDriver;
};

export const BACKUP_COLLECTIONS = {
  snapshots: "backupSnapshots",
  state: "backupState",
  currentState: "current",
  canonicalV2: "memosV2",
  snapshotLegacy: "memos",
  snapshotV2: "memosV2",
  snapshotV3: "memosV3",
  deletedLegacy: "serverMemoDeletes",
  deletedV2: "serverMemoDeletesV2",
} as const;

export const MAX_MEMOS_PER_BATCH = 200;

type FirestoreTimestamp = { toDate(): Date };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function normalizeFirestoreTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (isRecord(value) && typeof value.toDate === "function") {
    try {
      const date = (value as unknown as FirestoreTimestamp).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function snapshotCollection(context: FirestoreBackupContext, userId: string) {
  return context.driver.collection(
    context.firestore,
    "users",
    userId,
    BACKUP_COLLECTIONS.snapshots
  );
}

export function activationDoc(context: FirestoreBackupContext, userId: string) {
  return context.driver.doc(
    context.firestore,
    "users",
    userId,
    BACKUP_COLLECTIONS.state,
    BACKUP_COLLECTIONS.currentState
  );
}

export function canonicalMemoCollection(context: FirestoreBackupContext, userId: string) {
  return context.driver.collection(
    context.firestore,
    "users",
    userId,
    BACKUP_COLLECTIONS.canonicalV2
  );
}

export function canonicalMemoDocCandidates(
  context: FirestoreBackupContext,
  userId: string,
  memoId: string
) {
  const documentIds = [encodeMemoDocumentId(memoId)];
  if (canUseLegacyRawMemoDocumentId(memoId)) {
    documentIds.push(memoId);
  }

  return [
    {
      ref: context.driver.doc(
        context.firestore,
        "users",
        userId,
        BACKUP_COLLECTIONS.canonicalV2,
        encodeMemoDocumentId(memoId)
      ),
      isLegacy: false,
    },
    ...[...new Set(documentIds)].map((documentId) => ({
      ref: context.driver.doc(context.firestore, "users", userId, BACKUP_COLLECTIONS.snapshotLegacy, documentId),
      isLegacy: true,
    })),
  ];
}

export function deletedMemoCollection(context: FirestoreBackupContext, userId: string) {
  return context.driver.collection(
    context.firestore,
    "users",
    userId,
    BACKUP_COLLECTIONS.deletedV2
  );
}

export function deletedMemoDoc(
  context: FirestoreBackupContext,
  userId: string,
  memoId: string
) {
  return context.driver.doc(
    context.firestore,
    "users",
    userId,
    BACKUP_COLLECTIONS.deletedV2,
    encodeMemoDocumentId(memoId)
  );
}

export function legacyDeletedMemoDocs(context: FirestoreBackupContext, userId: string) {
  return context.driver.collection(
    context.firestore,
    "users",
    userId,
    BACKUP_COLLECTIONS.deletedLegacy
  );
}

export function chunkMemos<T>(memos: T[]) {
  const chunks: T[][] = [];
  for (let index = 0; index < memos.length; index += MAX_MEMOS_PER_BATCH) {
    chunks.push(memos.slice(index, index + MAX_MEMOS_PER_BATCH));
  }
  return chunks;
}

export function activeSnapshotIdFromState(snapshot: DriverDocumentSnapshot): string | null {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return typeof data.activeSnapshotId === "string" && data.activeSnapshotId !== ""
    ? data.activeSnapshotId
    : null;
}

export function activeSchemaVersionFromState(
  snapshot: DriverDocumentSnapshot
): 1 | 2 | 3 | null {
  if (!snapshot.exists()) return null;
  const value = snapshot.data().activeSchemaVersion;
  return value === 1 || value === 2 || value === 3 ? value : null;
}

export function activatedAtFromState(snapshot: DriverDocumentSnapshot): unknown | null {
  if (!snapshot.exists()) return null;
  const activatedAt = snapshot.data().activatedAt;
  return normalizeFirestoreTimestamp(activatedAt) === null ? null : activatedAt;
}

export function assertPendingSnapshotLease(
  snapshot: DriverDocumentSnapshot,
  userId: string,
  snapshotId: string
) {
  if (
    !snapshot.exists() ||
    snapshot.data().userId !== userId ||
    snapshot.data().pendingSnapshotId !== snapshotId
  ) {
    throw new Error(`Backup ${snapshotId} was superseded by a newer backup`);
  }
}

export function assertUniqueActiveMemoIds(memos: Memo[]) {
  const memoIds = new Set<string>();
  for (const memo of memos) {
    if (memoIds.has(memo.id)) {
      throw new Error(`Duplicate active memo ID: ${memo.id}`);
    }
    memoIds.add(memo.id);
  }
}

export function assertValidNewBackupPayload(payload: MemoBackupPayload, userId: string) {
  const parsed = validateBackupPayload(payload, userId);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.payload;
}

export type CanonicalReference = { snapshotId: string; savedAt: unknown };
export type CanonicalMemoCandidate = {
  ref: unknown;
  snapshot: DriverDocumentSnapshot;
  isLegacy: boolean;
};

export function readCanonicalReference(value: unknown): CanonicalReference | null {
  if (!isRecord(value) || typeof value.snapshotId !== "string" || value.snapshotId === "") {
    return null;
  }
  return normalizeFirestoreTimestamp(value.savedAt) === null
    ? null
    : { snapshotId: value.snapshotId, savedAt: value.savedAt };
}

export function canonicalReferenceForSnapshot(
  data: Record<string, unknown>,
  snapshotId: string
): CanonicalReference | null {
  const pending = readCanonicalReference(data.pending);
  if (pending?.snapshotId === snapshotId) return pending;
  const active = readCanonicalReference(data.active);
  return active?.snapshotId === snapshotId ? active : null;
}

export function canonicalReferenceData(reference: CanonicalReference | null) {
  return reference === null ? null : { snapshotId: reference.snapshotId, savedAt: reference.savedAt };
}

export function isMemoDocumentForPath(
  documentId: string,
  memoId: string,
  isLegacy: boolean
): boolean {
  // Legacy raw paths can resemble encoded IDs; only exact legacy matches are safe.
  return isLegacy ? documentId === memoId : documentId === encodeMemoDocumentId(memoId);
}

export function isStoredCanonicalMemoFor(
  snapshot: DriverDocumentSnapshot,
  userId: string,
  memoId: string,
  isLegacy: boolean
): boolean {
  if (!snapshot.exists()) return false;
  const data = snapshot.data();
  return (
    data.userId === userId &&
    data.memoId === memoId &&
    isMemoDocumentForPath(snapshot.id, memoId, isLegacy)
  );
}
