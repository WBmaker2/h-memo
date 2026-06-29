import {
  createBackupPayload as createMemoBackupPayload,
  validateBackupPayload,
  type BackupPayload,
  type Memo,
} from "@h-memo/memo-core";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

export type MemoBackupPayload = BackupPayload;
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
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteMemoFromBackups(userId: string, memoId: string): Promise<number>;
}

const backupCollection = "backupSnapshots";
const serverMemoDeletesCollection = "serverMemoDeletes";

export class FirestoreBackupGateway implements BackupGateway {
  constructor(private readonly firestore: Firestore) {}

  private collection(userId: string) {
    return collection(this.firestore, "users", userId, backupCollection);
  }

  private deletedMemoCollection(userId: string) {
    return collection(this.firestore, "users", userId, serverMemoDeletesCollection);
  }

  private deletedMemoDoc(userId: string, memoId: string) {
    return doc(this.firestore, "users", userId, serverMemoDeletesCollection, memoId);
  }

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const ref = await addDoc(this.collection(userId), {
      ...payload,
      savedAt: serverTimestamp(),
    });

    await Promise.all(
      payload.memos
        .filter((memo) => memo.deletedAt === null)
        .map((memo) => deleteDoc(this.deletedMemoDoc(userId, memo.id)))
    );

    return ref.path;
  }

  async loadLatestBackup(userId: string): Promise<unknown | null> {
    const snapshotQuery = query(
      this.collection(userId),
      orderBy("savedAt", "desc"),
      limit(1)
    );
    const querySnapshot = await getDocs(snapshotQuery);
    if (querySnapshot.empty) {
      return null;
    }

    const latest = querySnapshot.docs[0];
    return latest.data();
  }

  async loadBackups(userId: string): Promise<unknown[]> {
    const snapshotQuery = query(
      this.collection(userId),
      orderBy("savedAt", "desc")
    );
    const querySnapshot = await getDocs(snapshotQuery);
    return querySnapshot.docs.map((snapshot) => snapshot.data());
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

  async deleteMemoFromBackups(userId: string, memoId: string): Promise<number> {
    await setDoc(this.deletedMemoDoc(userId, memoId), {
      userId,
      memoId,
      deletedAt: serverTimestamp(),
    });

    const snapshotQuery = query(
      this.collection(userId),
      orderBy("savedAt", "desc")
    );
    const querySnapshot = await getDocs(snapshotQuery);
    let updatedSnapshots = 0;

    await Promise.all(
      querySnapshot.docs.map(async (snapshot) => {
        const data = snapshot.data();
        const memos = Array.isArray(data.memos) ? data.memos : [];
        const nextMemos = memos.filter((memo) => {
          return !memo || typeof memo !== "object" || (memo as { id?: unknown }).id !== memoId;
        });

        if (nextMemos.length === memos.length) {
          return;
        }

        await updateDoc(snapshot.ref, { memos: nextMemos });
        updatedSnapshots += 1;
      })
    );

    return Math.max(updatedSnapshots, 1);
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
  const latest = await gateway.loadLatestBackup(userId);
  if (latest === null) {
    return null;
  }

  const parsed = validateBackupPayload(latest, userId);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }

  const deletedMemoIds = await loadDeletedMemoIdSet(gateway, userId);
  return filterDeletedServerMemos(parsed.payload, deletedMemoIds);
}

export async function listBackedUpMemos(
  gateway: BackupGateway,
  userId: string
): Promise<BackedUpMemo[]> {
  const backups = await gateway.loadBackups(userId);
  const deletedMemoIds = await loadDeletedMemoIdSet(gateway, userId);
  const newestMemoById = new Map<string, BackedUpMemo>();

  for (const backup of backups) {
    const parsed = validateBackupPayload(backup, userId);
    if (!parsed.ok) {
      continue;
    }

    for (const memo of parsed.payload.memos) {
      if (deletedMemoIds.has(memo.id)) {
        continue;
      }
      if (newestMemoById.has(memo.id)) {
        continue;
      }
      newestMemoById.set(memo.id, {
        memo,
        backupCreatedAt: parsed.payload.createdAt,
      });
    }
  }

  return [...newestMemoById.values()].sort((a, b) =>
    b.memo.updatedAt.localeCompare(a.memo.updatedAt)
  );
}

export async function listBackupSnapshots(
  gateway: BackupGateway,
  userId: string
): Promise<BackedUpSnapshot[]> {
  const backups = await gateway.loadBackups(userId);
  const deletedMemoIds = await loadDeletedMemoIdSet(gateway, userId);
  const snapshots: BackedUpSnapshot[] = [];

  for (const backup of backups) {
    const parsed = validateBackupPayload(backup, userId);
    if (!parsed.ok) {
      continue;
    }

    const payload = filterDeletedServerMemos(parsed.payload, deletedMemoIds);
    snapshots.push({
      createdAt: payload.createdAt,
      memoCount: payload.memos.length,
      payload,
    });
  }

  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteBackedUpMemo(
  gateway: BackupGateway,
  userId: string,
  memoId: string
): Promise<number> {
  return gateway.deleteMemoFromBackups(userId, memoId);
}
