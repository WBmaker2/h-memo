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
  type Firestore,
} from "firebase/firestore";

export type MemoBackupPayload = BackupPayload;

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
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
