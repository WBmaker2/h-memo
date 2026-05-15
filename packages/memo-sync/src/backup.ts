import {
  createBackupPayload as createMemoBackupPayload,
  validateBackupPayload,
  type BackupPayload,
  type Memo,
} from "@h-memo/memo-core";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

export type MemoBackupPayload = BackupPayload;
export type BackedUpMemo = {
  memo: Memo;
  backupCreatedAt: string;
};

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
  loadBackups(userId: string): Promise<unknown[]>;
  deleteMemoFromBackups(userId: string, memoId: string): Promise<number>;
}

const backupCollection = "backupSnapshots";

export class FirestoreBackupGateway implements BackupGateway {
  constructor(private readonly firestore: Firestore) {}

  private collection(userId: string) {
    return collection(this.firestore, "users", userId, backupCollection);
  }

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const ref = await addDoc(this.collection(userId), {
      ...payload,
      savedAt: serverTimestamp(),
    });
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

  async deleteMemoFromBackups(userId: string, memoId: string): Promise<number> {
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

    return updatedSnapshots;
  }
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

  return parsed.payload;
}

export async function listBackedUpMemos(
  gateway: BackupGateway,
  userId: string
): Promise<BackedUpMemo[]> {
  const backups = await gateway.loadBackups(userId);
  const newestMemoById = new Map<string, BackedUpMemo>();

  for (const backup of backups) {
    const parsed = validateBackupPayload(backup, userId);
    if (!parsed.ok) {
      continue;
    }

    for (const memo of parsed.payload.memos) {
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

export async function deleteBackedUpMemo(
  gateway: BackupGateway,
  userId: string,
  memoId: string
): Promise<number> {
  return gateway.deleteMemoFromBackups(userId, memoId);
}
