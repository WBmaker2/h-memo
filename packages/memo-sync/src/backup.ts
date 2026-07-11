import {
  createBackupPayload as createMemoBackupPayload,
  validateBackupPayload,
  type BackupPayload,
  type Memo,
} from "@h-memo/memo-core";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

export type MemoBackupPayload = BackupPayload;
export type StoredBackupSnapshot = {
  id: string;
  payload: MemoBackupPayload;
  savedAt: string;
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
  loadCurrentMemos(userId: string): Promise<Memo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}

const backupSnapshotsCollection = "backupSnapshots";
const canonicalMemosCollection = "memos";
const snapshotMemosCollection = "memos";
const serverMemoDeletesCollection = "serverMemoDeletes";
const maxMemosPerBatch = 200;

type FirestoreTimestamp = {
  toDate(): Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeFirestoreTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (isRecord(value) && typeof value.toDate === "function") {
    const date = (value as unknown as FirestoreTimestamp).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }

  return null;
}

function isIncompleteSchemaV2Snapshot(value: unknown) {
  return isRecord(value) && value.schemaVersion === 2 && value.state !== "complete";
}

function toStoredBackupSnapshot(
  value: unknown,
  userId: string
): StoredBackupSnapshot | null {
  if (isIncompleteSchemaV2Snapshot(value)) {
    return null;
  }

  const record = isRecord(value) ? value : null;
  const payloadValue = record && "payload" in record ? record.payload : value;
  const parsed = validateBackupPayload(payloadValue, userId);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }

  const savedAt = normalizeFirestoreTimestamp(record?.savedAt) ?? parsed.payload.createdAt;
  return {
    id: typeof record?.id === "string" ? record.id : "",
    payload: parsed.payload,
    savedAt,
  };
}

function sortStoredSnapshots(snapshots: StoredBackupSnapshot[]) {
  return [...snapshots].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function loadStoredBackupSnapshots(
  gateway: BackupGateway,
  userId: string
): Promise<StoredBackupSnapshot[]> {
  const snapshots = (await gateway.loadBackups(userId))
    .map((snapshot) => toStoredBackupSnapshot(snapshot, userId))
    .filter((snapshot): snapshot is StoredBackupSnapshot => snapshot !== null);
  return sortStoredSnapshots(snapshots);
}

function chunkMemos<T>(memos: T[]) {
  const chunks: T[][] = [];
  for (let index = 0; index < memos.length; index += maxMemosPerBatch) {
    chunks.push(memos.slice(index, index + maxMemosPerBatch));
  }
  return chunks;
}

function isValidMemo(memo: unknown, userId: string): memo is Memo {
  return validateBackupPayload(
    {
      version: 1,
      userId,
      createdAt: "",
      memos: [memo],
    },
    userId
  ).ok;
}

export class FirestoreBackupGateway implements BackupGateway {
  constructor(private readonly firestore: Firestore) {}

  private snapshotCollection(userId: string) {
    return collection(this.firestore, "users", userId, backupSnapshotsCollection);
  }

  private canonicalMemoCollection(userId: string) {
    return collection(this.firestore, "users", userId, canonicalMemosCollection);
  }

  private canonicalMemoDoc(userId: string, memoId: string) {
    return doc(this.firestore, "users", userId, canonicalMemosCollection, memoId);
  }

  private deletedMemoCollection(userId: string) {
    return collection(this.firestore, "users", userId, serverMemoDeletesCollection);
  }

  private deletedMemoDoc(userId: string, memoId: string) {
    return doc(this.firestore, "users", userId, serverMemoDeletesCollection, memoId);
  }

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const activeMemos = payload.memos.filter((memo) => memo.deletedAt === null);
    const snapshotRef = doc(this.snapshotCollection(userId));

    await setDoc(snapshotRef, {
      schemaVersion: 2,
      userId,
      createdAt: payload.createdAt,
      memoCount: activeMemos.length,
      state: "writing",
    });

    for (const memoChunk of chunkMemos(activeMemos)) {
      const memoBatch = writeBatch(this.firestore);
      for (const memo of memoChunk) {
        memoBatch.set(this.canonicalMemoDoc(userId, memo.id), {
          userId,
          memoId: memo.id,
          memo,
          savedAt: serverTimestamp(),
        });
        memoBatch.set(doc(snapshotRef, snapshotMemosCollection, memo.id), {
          userId,
          memoId: memo.id,
          memo,
        });
      }
      await memoBatch.commit();

      const tombstoneBatch = writeBatch(this.firestore);
      for (const memo of memoChunk) {
        tombstoneBatch.delete(this.deletedMemoDoc(userId, memo.id));
      }
      await tombstoneBatch.commit();
    }

    await updateDoc(snapshotRef, {
      state: "complete",
      savedAt: serverTimestamp(),
    });

    return snapshotRef.path;
  }

  async loadLatestBackup(userId: string): Promise<unknown | null> {
    return (await this.loadBackups(userId))[0] ?? null;
  }

  async loadBackups(userId: string): Promise<unknown[]> {
    const snapshotDocs = await getDocs(this.snapshotCollection(userId));
    const storedSnapshots = await Promise.all(
      snapshotDocs.docs.map((snapshot) => this.loadStoredSnapshot(snapshot, userId))
    );
    return sortStoredSnapshots(
      storedSnapshots.filter(
        (snapshot): snapshot is StoredBackupSnapshot => snapshot !== null
      )
    );
  }

  private async loadStoredSnapshot(
    snapshot: QueryDocumentSnapshot,
    userId: string
  ): Promise<StoredBackupSnapshot | null> {
    const data = snapshot.data();
    if (data.schemaVersion === 2) {
      return this.loadCompleteSchemaV2Snapshot(snapshot, userId);
    }

    const parsed = validateBackupPayload(data, userId);
    if (!parsed.ok) {
      return null;
    }

    return {
      id: snapshot.id,
      payload: parsed.payload,
      savedAt: normalizeFirestoreTimestamp(data.savedAt) ?? parsed.payload.createdAt,
    };
  }

  private async loadCompleteSchemaV2Snapshot(
    snapshot: QueryDocumentSnapshot,
    userId: string
  ): Promise<StoredBackupSnapshot | null> {
    const data = snapshot.data();
    const savedAt = normalizeFirestoreTimestamp(data.savedAt);
    if (
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

    const memoDocs = await getDocs(collection(snapshot.ref, snapshotMemosCollection));
    const memos = memoDocs.docs
      .map((memoSnapshot) => memoSnapshot.data().memo)
      .filter((memo): memo is Memo => isValidMemo(memo, userId));
    if (memos.length !== data.memoCount) {
      return null;
    }

    const parsed = validateBackupPayload(
      {
        version: 1,
        userId,
        createdAt: data.createdAt,
        memos,
      },
      userId
    );
    if (!parsed.ok) {
      return null;
    }

    return {
      id: snapshot.id,
      payload: parsed.payload,
      savedAt,
    };
  }

  async loadCurrentMemos(userId: string): Promise<Memo[]> {
    const memoDocs = await getDocs(this.canonicalMemoCollection(userId));
    return memoDocs.docs
      .map((snapshot) => snapshot.data().memo)
      .filter((memo): memo is Memo => isValidMemo(memo, userId));
  }

  async loadDeletedMemoIds(userId: string): Promise<string[]> {
    const querySnapshot = await getDocs(this.deletedMemoCollection(userId));
    return querySnapshot.docs
      .map((snapshot) => {
        const data = snapshot.data();
        return typeof data.memoId === "string" ? data.memoId : snapshot.id;
      })
      .filter((memoId) => memoId.trim() !== "");
  }

  async deleteCurrentMemo(userId: string, memoId: string): Promise<number> {
    const batch = writeBatch(this.firestore);
    batch.set(this.deletedMemoDoc(userId, memoId), {
      userId,
      memoId,
      deletedAt: serverTimestamp(),
    });
    batch.delete(this.canonicalMemoDoc(userId, memoId));
    await batch.commit();
    return 1;
  }
}

async function loadDeletedMemoIdSet(
  gateway: BackupGateway,
  userId: string
): Promise<Set<string>> {
  return new Set(await gateway.loadDeletedMemoIds(userId));
}

function filterDeletedServerMemos(payload: MemoBackupPayload, deletedMemoIds: Set<string>) {
  if (deletedMemoIds.size === 0) {
    return payload;
  }

  return {
    ...payload,
    memos: payload.memos.filter((memo) => !deletedMemoIds.has(memo.id)),
  };
}

export async function backupMemos(
  gateway: BackupGateway,
  userId: string,
  memos: Memo[],
  now = new Date().toISOString()
): Promise<{
  path: string;
  payload: MemoBackupPayload;
}> {
  const payload = createMemoBackupPayload({
    userId,
    memos,
    createdAt: now,
  });
  const path = await gateway.saveBackup(userId, payload);
  return {
    path,
    payload,
  };
}

export async function restoreLatestBackup(
  gateway: BackupGateway,
  userId: string
): Promise<MemoBackupPayload | null> {
  const latest = (await loadStoredBackupSnapshots(gateway, userId))[0];
  if (!latest) {
    return null;
  }

  const deletedMemoIds = await loadDeletedMemoIdSet(gateway, userId);
  return filterDeletedServerMemos(latest.payload, deletedMemoIds);
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
    .filter((memo) => memo.deletedAt === null && !deletedMemoIds.has(memo.id))
    .map((memo) => ({
      memo,
      backupCreatedAt: memo.updatedAt,
    }))
    .sort((a, b) => b.memo.updatedAt.localeCompare(a.memo.updatedAt));
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
    return {
      createdAt: backup.savedAt,
      memoCount: payload.memos.length,
      payload,
    };
  });
}

export async function deleteBackedUpMemo(
  gateway: BackupGateway,
  userId: string,
  memoId: string
): Promise<number> {
  return gateway.deleteCurrentMemo(userId, memoId);
}
