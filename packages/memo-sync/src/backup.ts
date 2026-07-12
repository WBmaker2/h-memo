import {
  createBackupPayload as createMemoBackupPayload,
  validateBackupPayload,
  type BackupPayload,
  type Memo,
} from "@h-memo/memo-core";
import {
  collection as firestoreCollection,
  doc as firestoreDoc,
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  runTransaction as firestoreRunTransaction,
  serverTimestamp as firestoreServerTimestamp,
  setDoc as firestoreSetDoc,
  writeBatch as firestoreWriteBatch,
  type Firestore,
} from "firebase/firestore";

export type MemoBackupPayload = BackupPayload;
export type StoredBackupSnapshot = {
  id: string;
  payload: MemoBackupPayload;
  savedAt: string;
};
export type StoredCurrentMemo = {
  memo: Memo;
  savedAt: string;
  snapshotId: string;
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

type DriverDocumentSnapshot = {
  id: string;
  ref: unknown;
  exists(): boolean;
  data(): Record<string, unknown>;
};
type DriverQuerySnapshot = {
  docs: DriverDocumentSnapshot[];
  empty: boolean;
};
type DriverWriteBatch = {
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  update(ref: unknown, data: Record<string, unknown>): void;
  delete(ref: unknown): void;
  commit(): Promise<void>;
};
type DriverTransaction = {
  get(ref: unknown): Promise<DriverDocumentSnapshot>;
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  update(ref: unknown, data: Record<string, unknown>): void;
};

export type FirestoreBackupDriver = {
  collection(parent: unknown, ...segments: string[]): unknown;
  doc(parent: unknown, ...segments: string[]): unknown;
  id(ref: unknown): string;
  getDoc(ref: unknown): Promise<DriverDocumentSnapshot>;
  getDocs(ref: unknown): Promise<DriverQuerySnapshot>;
  setDoc(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  writeBatch(firestore: unknown): DriverWriteBatch;
  runTransaction<T>(
    firestore: unknown,
    updater: (transaction: DriverTransaction) => Promise<T>
  ): Promise<T>;
  serverTimestamp(): unknown;
};

const firebaseDriver: FirestoreBackupDriver = {
  collection: (parent, ...segments) =>
    (firestoreCollection as unknown as (parent: unknown, ...paths: string[]) => unknown)(
      parent,
      ...segments
    ),
  doc: (parent, ...segments) =>
    (firestoreDoc as unknown as (parent: unknown, ...paths: string[]) => unknown)(parent, ...segments),
  id: (ref) => (ref as { id: string }).id,
  getDoc: async (ref) => (await firestoreGetDoc(ref as never)) as unknown as DriverDocumentSnapshot,
  getDocs: async (ref) => (await firestoreGetDocs(ref as never)) as unknown as DriverQuerySnapshot,
  setDoc: async (ref, data, options) => {
    await firestoreSetDoc(ref as never, data as never, options as never);
  },
  writeBatch: (firestore) => {
    const batch = firestoreWriteBatch(firestore as Firestore);
    return {
      set: (ref, data, options) => batch.set(ref as never, data as never, options as never),
      update: (ref, data) => batch.update(ref as never, data as never),
      delete: (ref) => batch.delete(ref as never),
      commit: () => batch.commit(),
    };
  },
  runTransaction: (firestore, updater) =>
    firestoreRunTransaction(firestore as Firestore, async (transaction) =>
      updater({
        get: async (ref) =>
          (await transaction.get(ref as never)) as unknown as DriverDocumentSnapshot,
        set: (ref, data, options) => transaction.set(ref as never, data as never, options as never),
        update: (ref, data) => transaction.update(ref as never, data as never),
      })
    ),
  serverTimestamp: () => firestoreServerTimestamp(),
};

export interface BackupGateway {
  saveBackup(userId: string, payload: MemoBackupPayload): Promise<string>;
  loadLatestBackup(userId: string): Promise<unknown | null>;
  loadBackups(userId: string): Promise<unknown[]>;
  loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]>;
  loadDeletedMemoIds(userId: string): Promise<string[]>;
  deleteCurrentMemo(userId: string, memoId: string): Promise<number>;
}

const backupSnapshotsCollection = "backupSnapshots";
const backupStateCollection = "backupState";
const backupStateDocument = "current";
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
      createdAt: "1970-01-01T00:00:00.000Z",
      memos: [memo],
    },
    userId
  ).ok;
}

function activeSnapshotIdFromState(snapshot: DriverDocumentSnapshot): string | null {
  if (!snapshot.exists()) {
    return null;
  }
  const data = snapshot.data();
  return typeof data.activeSnapshotId === "string" && data.activeSnapshotId !== ""
    ? data.activeSnapshotId
    : null;
}

function activatedAtFromState(snapshot: DriverDocumentSnapshot): unknown | null {
  if (!snapshot.exists()) {
    return null;
  }

  const activatedAt = snapshot.data().activatedAt;
  return normalizeFirestoreTimestamp(activatedAt) === null ? null : activatedAt;
}

function assertPendingSnapshotLease(
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

function assertUniqueActiveMemoIds(memos: Memo[]) {
  const memoIds = new Set<string>();
  for (const memo of memos) {
    if (memoIds.has(memo.id)) {
      throw new Error(`Duplicate active memo ID: ${memo.id}`);
    }
    memoIds.add(memo.id);
  }
}

type CanonicalReference = {
  snapshotId: string;
  savedAt: unknown;
};

function readCanonicalReference(value: unknown): CanonicalReference | null {
  if (!isRecord(value) || typeof value.snapshotId !== "string" || value.snapshotId === "") {
    return null;
  }

  return normalizeFirestoreTimestamp(value.savedAt) === null
    ? null
    : { snapshotId: value.snapshotId, savedAt: value.savedAt };
}

function canonicalReferenceForSnapshot(
  data: Record<string, unknown>,
  snapshotId: string
): CanonicalReference | null {
  const pending = readCanonicalReference(data.pending);
  if (pending?.snapshotId === snapshotId) {
    return pending;
  }

  const active = readCanonicalReference(data.active);
  return active?.snapshotId === snapshotId ? active : null;
}

function canonicalReferenceData(reference: CanonicalReference | null) {
  return reference === null
    ? null
    : {
        snapshotId: reference.snapshotId,
        savedAt: reference.savedAt,
      };
}

export class FirestoreBackupGateway implements BackupGateway {
  constructor(
    private readonly firestore: Firestore,
    private readonly driver: FirestoreBackupDriver = firebaseDriver
  ) {}

  private snapshotCollection(userId: string) {
    return this.driver.collection(this.firestore, "users", userId, backupSnapshotsCollection);
  }

  private activationDoc(userId: string) {
    return this.driver.doc(
      this.firestore,
      "users",
      userId,
      backupStateCollection,
      backupStateDocument
    );
  }

  private canonicalMemoCollection(userId: string) {
    return this.driver.collection(this.firestore, "users", userId, canonicalMemosCollection);
  }

  private canonicalMemoDoc(userId: string, memoId: string) {
    return this.driver.doc(this.firestore, "users", userId, canonicalMemosCollection, memoId);
  }

  private deletedMemoCollection(userId: string) {
    return this.driver.collection(this.firestore, "users", userId, serverMemoDeletesCollection);
  }

  private deletedMemoDoc(userId: string, memoId: string) {
    return this.driver.doc(this.firestore, "users", userId, serverMemoDeletesCollection, memoId);
  }

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const activeMemos = payload.memos.filter((memo) => memo.deletedAt === null);
    assertUniqueActiveMemoIds(activeMemos);
    const snapshotRef = this.driver.doc(this.snapshotCollection(userId));
    const snapshotId = this.driver.id(snapshotRef);

    const activeSnapshotId = await this.driver.runTransaction(
      this.firestore,
      async (transaction) => {
        const activeState = await transaction.get(this.activationDoc(userId));
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
        transaction.set(this.activationDoc(userId), {
          userId,
          activeSnapshotId: priorActiveSnapshotId,
          pendingSnapshotId: snapshotId,
          activatedAt: activatedAtFromState(activeState),
        });
        return priorActiveSnapshotId;
      }
    );

    for (const memoChunk of chunkMemos(activeMemos)) {
      await this.driver.runTransaction(this.firestore, async (transaction) => {
        assertPendingSnapshotLease(
          await transaction.get(this.activationDoc(userId)),
          userId,
          snapshotId
        );

        const canonicalMemos = await Promise.all(
          memoChunk.map((memo) => transaction.get(this.canonicalMemoDoc(userId, memo.id)))
        );

        for (const [index, memo] of memoChunk.entries()) {
          const canonicalMemoRef = this.canonicalMemoDoc(userId, memo.id);
          const existingCanonicalMemo = canonicalMemos[index]!;
          const previousActiveReference =
            activeSnapshotId && existingCanonicalMemo.exists()
              ? canonicalReferenceForSnapshot(existingCanonicalMemo.data(), activeSnapshotId)
              : null;
          const stagedReferences = {
            active: canonicalReferenceData(previousActiveReference),
            pending: {
              snapshotId,
              savedAt: this.driver.serverTimestamp(),
            },
          };

          if (existingCanonicalMemo.exists()) {
            transaction.update(canonicalMemoRef, stagedReferences);
          } else {
            transaction.set(canonicalMemoRef, {
              userId,
              memoId: memo.id,
              ...stagedReferences,
            });
          }
          transaction.set(this.driver.doc(snapshotRef, snapshotMemosCollection, memo.id), {
            userId,
            memoId: memo.id,
            memo,
          });
        }
      });
    }

    await this.driver.runTransaction(this.firestore, async (transaction) => {
      assertPendingSnapshotLease(
        await transaction.get(this.activationDoc(userId)),
        userId,
        snapshotId
      );
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
        savedAt: this.driver.serverTimestamp(),
      });
      transaction.set(this.activationDoc(userId), {
        userId,
        activeSnapshotId: snapshotId,
        pendingSnapshotId: null,
        activatedAt: this.driver.serverTimestamp(),
      });
    });

    return `${(snapshotRef as { path?: string }).path ?? `users/${userId}/${backupSnapshotsCollection}/${snapshotId}`}`;
  }

  async loadLatestBackup(userId: string): Promise<unknown | null> {
    return (await this.loadBackups(userId))[0] ?? null;
  }

  async loadBackups(userId: string): Promise<unknown[]> {
    const snapshotDocs = await this.driver.getDocs(this.snapshotCollection(userId));
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
    snapshot: DriverDocumentSnapshot,
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
    snapshot: DriverDocumentSnapshot,
    userId: string
  ): Promise<StoredBackupSnapshot | null> {
    if (!snapshot.exists()) {
      return null;
    }
    const data = snapshot.data();
    const savedAt = normalizeFirestoreTimestamp(data.savedAt);
    if (
      data.schemaVersion !== 2 ||
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

    const memoDocs = await this.driver.getDocs(
      this.driver.collection(snapshot.ref, snapshotMemosCollection)
    );
    if (memoDocs.docs.length !== data.memoCount) {
      return null;
    }

    const memos: Memo[] = [];
    for (const memoSnapshot of memoDocs.docs) {
      const wrapper = memoSnapshot.data();
      const memo = wrapper.memo;
      if (
        wrapper.userId !== userId ||
        wrapper.memoId !== memoSnapshot.id ||
        !isValidMemo(memo, userId) ||
        memo.id !== memoSnapshot.id
      ) {
        return null;
      }
      memos.push(memo);
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

  async loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]> {
    const activeSnapshotId = activeSnapshotIdFromState(
      await this.driver.getDoc(this.activationDoc(userId))
    );
    if (!activeSnapshotId) {
      return [];
    }

    const activeSnapshot = await this.loadCompleteSchemaV2Snapshot(
      await this.driver.getDoc(this.driver.doc(this.snapshotCollection(userId), activeSnapshotId)),
      userId
    );
    if (!activeSnapshot) {
      return [];
    }

    const snapshotMemosById = new Map(
      activeSnapshot.payload.memos.map((memo) => [memo.id, memo])
    );
    const memoDocs = await this.driver.getDocs(this.canonicalMemoCollection(userId));
    const currentMemos: StoredCurrentMemo[] = [];
    for (const memoSnapshot of memoDocs.docs) {
      const data = memoSnapshot.data();
      const reference = canonicalReferenceForSnapshot(data, activeSnapshotId);
      const memo = snapshotMemosById.get(memoSnapshot.id);
      const savedAt = normalizeFirestoreTimestamp(reference?.savedAt);
      if (
        data.userId !== userId ||
        data.memoId !== memoSnapshot.id ||
        reference?.snapshotId !== activeSnapshotId ||
        !isValidMemo(memo, userId) ||
        memo.id !== memoSnapshot.id ||
        savedAt === null
      ) {
        continue;
      }
      currentMemos.push({ memo, savedAt, snapshotId: activeSnapshotId });
    }
    return currentMemos;
  }

  async loadDeletedMemoIds(userId: string): Promise<string[]> {
    const [currentMemos, querySnapshot] = await Promise.all([
      this.loadCurrentMemos(userId),
      this.driver.getDocs(this.deletedMemoCollection(userId)),
    ]);
    const activeMemoIds = new Set(currentMemos.map((entry) => entry.memo.id));
    return querySnapshot.docs
      .flatMap((snapshot) => {
        const data = snapshot.data();
        if (
          data.userId !== userId ||
          data.memoId !== snapshot.id ||
          snapshot.id.trim() === "" ||
          activeMemoIds.has(snapshot.id)
        ) {
          return [];
        }
        return [snapshot.id];
      });
  }

  async deleteCurrentMemo(userId: string, memoId: string): Promise<number> {
    return this.driver.runTransaction(this.firestore, async (transaction) => {
      const activeSnapshotId = activeSnapshotIdFromState(
        await transaction.get(this.activationDoc(userId))
      );
      if (!activeSnapshotId) {
        return 0;
      }

      const canonicalMemoRef = this.canonicalMemoDoc(userId, memoId);
      const canonicalMemo = await transaction.get(canonicalMemoRef);
      transaction.set(this.deletedMemoDoc(userId, memoId), {
        userId,
        memoId,
        snapshotId: activeSnapshotId,
        deletedAt: this.driver.serverTimestamp(),
      });
      if (canonicalMemo.exists()) {
        const data = canonicalMemo.data();
        const active = readCanonicalReference(data.active);
        const pending = readCanonicalReference(data.pending);
        const activeMatches = active?.snapshotId === activeSnapshotId;
        const pendingMatches = pending?.snapshotId === activeSnapshotId;
        if (data.userId === userId && data.memoId === memoId && (activeMatches || pendingMatches)) {
          transaction.update(canonicalMemoRef, {
            active: activeMatches ? null : canonicalReferenceData(active),
            pending: pendingMatches ? null : canonicalReferenceData(pending),
          });
        }
      }
      return 1;
    });
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
    .filter((entry) => entry.memo.deletedAt === null && !deletedMemoIds.has(entry.memo.id))
    .map((entry) => ({
      memo: entry.memo,
      backupCreatedAt: entry.savedAt,
    }))
    .sort((a, b) => b.backupCreatedAt.localeCompare(a.backupCreatedAt));
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
