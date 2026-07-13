import type {
  BackupGateway,
  BackupSaveResult,
  MemoBackupPayload,
  StoredCurrentMemo,
} from "../backupTypes";

const SERVER_TIMESTAMP = Symbol("serverTimestamp");
const DELETE_FIELD = Symbol("deleteField");

type DriverRef = { path: string };
type DriverSnapshot = {
  id: string;
  ref: DriverRef;
  exists(): boolean;
  data(): Record<string, unknown>;
};
type DriverOperation = {
  kind: "set" | "update" | "delete";
  ref: DriverRef;
  data?: Record<string, unknown>;
  merge?: boolean;
};

export class FakeTimestamp {
  constructor(private readonly iso: string) {}

  toDate() {
    return new Date(this.iso);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof FakeTimestamp);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    ) as T;
  }
  return value;
}

export function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

export class FakeFirestoreDriver {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly committedDeletePaths: string[] = [];
  readonly batchOperationCounts: number[] = [];
  readonly transactionOperationCounts: number[] = [];
  readonly transactionReadCounts: number[] = [];
  readonly transactionWriteCounts: number[] = [];
  private readonly versions = new Map<string, number>();
  private nextDocument = 1;
  private serverClockMs = Date.parse("2026-05-13T09:00:00.000Z");
  private nextTimestamp = 0;
  private batchCommits = 0;
  transactionCommitCount = 0;
  maxTransactionReads = 500;
  maxTransactionWrites = 500;
  failBatchCommit: number | null = null;
  failTransactionCommit: number | null = null;
  beforeBatchCommit: ((operations: DriverOperation[]) => Promise<void>) | null = null;
  beforeTransactionCommit: ((operations: DriverOperation[]) => Promise<void>) | null = null;
  afterTransactionCommit: ((operations: DriverOperation[]) => Promise<void>) | null = null;
  onFirstTransactionRead: (() => Promise<void>) | null = null;
  private usedTransactionReadHook = false;

  setServerClock(iso: string) {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) throw new Error(`Invalid fake server clock: ${iso}`);
    this.serverClockMs = parsed;
    this.nextTimestamp = 0;
  }

  collection(parent: unknown, ...segments: string[]): DriverRef {
    return { path: this.joinPath(parent, segments) };
  }

  doc(parent: unknown, ...segments: string[]): DriverRef {
    if (segments.length === 0) {
      return { path: `${this.refPath(parent)}/${this.nextDocument++}` };
    }
    return { path: this.joinPath(parent, segments) };
  }

  id(ref: DriverRef) {
    return ref.path.split("/").at(-1)!;
  }

  async getDoc(ref: DriverRef) {
    return this.snapshot(ref.path, this.docs.get(ref.path));
  }

  async getDocs(ref: DriverRef) {
    const prefix = `${ref.path}/`;
    const docs: DriverSnapshot[] = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, data]) => this.snapshot(path, data));
    return { docs, empty: docs.length === 0 };
  }

  async setDoc(ref: DriverRef, data: Record<string, unknown>, options?: { merge?: boolean }) {
    this.apply([{ kind: "set", ref, data, merge: options?.merge }]);
  }

  async updateDoc(ref: DriverRef, data: Record<string, unknown>) {
    this.apply([{ kind: "update", ref, data }]);
  }

  writeBatch(_firestore?: unknown) {
    const operations: DriverOperation[] = [];
    return {
      set: (ref: DriverRef, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        operations.push({ kind: "set", ref, data, merge: options?.merge });
      },
      update: (ref: DriverRef, data: Record<string, unknown>) => {
        operations.push({ kind: "update", ref, data });
      },
      delete: (ref: DriverRef) => {
        operations.push({ kind: "delete", ref });
      },
      commit: async () => {
        this.batchCommits += 1;
        this.batchOperationCounts.push(operations.length);
        await this.beforeBatchCommit?.(operations);
        if (this.failBatchCommit === this.batchCommits) {
          throw new Error(`forced batch failure ${this.batchCommits}`);
        }
        for (const operation of operations) {
          if (operation.kind === "delete") this.committedDeletePaths.push(operation.ref.path);
        }
        this.apply(operations);
      },
    };
  }

  async runTransaction<T>(
    _firestore: unknown,
    updater: (transaction: {
      get(ref: DriverRef): Promise<ReturnType<FakeFirestoreDriver["snapshot"]>>;
      set(ref: DriverRef, data: Record<string, unknown>, options?: { merge?: boolean }): void;
      update(ref: DriverRef, data: Record<string, unknown>): void;
      delete(ref: DriverRef): void;
    }) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reads = new Map<string, number>();
      const operations: DriverOperation[] = [];
      const transaction = {
        get: async (ref: DriverRef) => {
          reads.set(ref.path, this.versions.get(ref.path) ?? 0);
          return this.snapshot(ref.path, this.docs.get(ref.path));
        },
        set: (ref: DriverRef, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          operations.push({ kind: "set", ref, data, merge: options?.merge });
        },
        update: (ref: DriverRef, data: Record<string, unknown>) => {
          operations.push({ kind: "update", ref, data });
        },
        delete: (ref: DriverRef) => {
          operations.push({ kind: "delete", ref });
        },
      };
      const result = await updater(transaction);
      if (!this.usedTransactionReadHook && reads.size > 0 && this.onFirstTransactionRead) {
        this.usedTransactionReadHook = true;
        await this.onFirstTransactionRead();
      }
      const hasConflict = () =>
        [...reads].some(([path, version]) => (this.versions.get(path) ?? 0) !== version);
      if (hasConflict()) continue;
      await this.beforeTransactionCommit?.(operations);
      if (hasConflict()) continue;
      this.transactionCommitCount += 1;
      this.transactionReadCounts.push(reads.size);
      this.transactionWriteCounts.push(operations.length);
      if (reads.size > this.maxTransactionReads || operations.length > this.maxTransactionWrites) {
        throw new Error(
          `transaction limit exceeded: ${reads.size} reads, ${operations.length} writes`
        );
      }
      this.transactionOperationCounts.push(operations.length);
      if (this.failTransactionCommit === this.transactionCommitCount) {
        throw new Error(`forced transaction failure ${this.transactionCommitCount}`);
      }
      this.apply(operations);
      await this.afterTransactionCommit?.(operations);
      return result;
    }
    throw new Error("transaction retry limit reached");
  }

  serverTimestamp() {
    return SERVER_TIMESTAMP;
  }

  deleteField() {
    return DELETE_FIELD;
  }

  seed(path: string, data: Record<string, unknown>) {
    this.docs.set(path, cloneValue(data));
    this.bump(path);
  }

  read(path: string) {
    const data = this.docs.get(path);
    return data ? cloneValue(data) : undefined;
  }

  hasPath(path: string) {
    return this.docs.has(path);
  }

  private joinPath(parent: unknown, segments: string[]) {
    const prefix = this.refPath(parent);
    return [prefix, ...segments].filter(Boolean).join("/");
  }

  private refPath(parent: unknown) {
    return isPlainRecord(parent) && typeof parent.path === "string" ? parent.path : "";
  }

  private snapshot(path: string, data?: Record<string, unknown>): DriverSnapshot {
    const ref = { path };
    return {
      id: path.split("/").at(-1)!,
      ref,
      exists: () => data !== undefined,
      data: () => cloneValue(data ?? {}),
    };
  }

  private apply(operations: DriverOperation[]) {
    for (const operation of operations) {
      if (operation.kind === "delete") {
        this.docs.delete(operation.ref.path);
        this.bump(operation.ref.path);
        continue;
      }

      const data = this.resolveValue(operation.data ?? {}) as Record<string, unknown>;
      const existing = this.docs.get(operation.ref.path) ?? {};
      const next = operation.kind === "set" && !operation.merge
        ? this.merge({}, data)
        : this.applyUpdate(existing, data);
      this.docs.set(operation.ref.path, next);
      this.bump(operation.ref.path);
    }
  }

  private resolveValue(value: unknown): unknown {
    if (value === SERVER_TIMESTAMP) return this.resolveServerTimestamp();
    if (Array.isArray(value)) return value.map((item) => this.resolveValue(item));
    if (isPlainRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.resolveValue(item)])
      );
    }
    return value;
  }

  private resolveServerTimestamp() {
    const value = new FakeTimestamp(
      new Date(this.serverClockMs + this.nextTimestamp * 1000).toISOString()
    );
    this.nextTimestamp += 1;
    return value;
  }

  private applyUpdate(existing: Record<string, unknown>, data: Record<string, unknown>) {
    const next = cloneValue(existing);
    for (const [key, value] of Object.entries(data)) {
      if (key.includes(".")) {
        this.setNestedValue(next, key.split("."), value);
      } else if (value === DELETE_FIELD) {
        delete next[key];
      } else if (isPlainRecord(value) && isPlainRecord(next[key])) {
        next[key] = this.applyUpdate(next[key] as Record<string, unknown>, value);
      } else {
        next[key] = cloneValue(value);
      }
    }
    return next;
  }

  private merge(existing: Record<string, unknown>, data: Record<string, unknown>) {
    return this.applyUpdate(existing, data);
  }

  private setNestedValue(target: Record<string, unknown>, segments: string[], value: unknown) {
    const last = segments.pop()!;
    let cursor = target;
    for (const segment of segments) {
      if (!isPlainRecord(cursor[segment])) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    if (value === DELETE_FIELD) delete cursor[last];
    else cursor[last] = cloneValue(value);
  }

  private bump(path: string) {
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
  }
}

type StoredPayload = MemoBackupPayload & { id: string; savedAt?: string };

export class FakeBackupGateway implements BackupGateway {
  private snapshots: StoredPayload[] = [];
  private currentMemosByUser = new Map<string, Map<string, StoredCurrentMemo>>();
  private deletedMemoSnapshotsByUser = new Map<string, Map<string, string>>();
  private activeSnapshotIdsByUser = new Map<string, string>();
  private savedAtQueue: string[] = [];
  private counter = 1;

  currentMemoLoadCount = 0;
  snapshotLoadCount = 0;
  legacySnapshotMutationCount = 0;

  queueServerSavedAt(savedAt: string) {
    this.savedAtQueue.push(savedAt);
  }

  addIncompleteSnapshot(userId: string, createdAt: string) {
    this.snapshots.push({
      id: `writing-${this.counter++}`,
      schemaVersion: 2,
      userId,
      createdAt,
      memoCount: 0,
      state: "writing",
    } as unknown as StoredPayload);
  }

  currentMemoIds(userId: string) {
    return [...(this.currentMemosByUser.get(userId)?.keys() ?? [])];
  }

  snapshotMemoIds() {
    return this.snapshots.flatMap((snapshot) => snapshot.memos.map((memo) => memo.id));
  }

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<BackupSaveResult> {
    const id = String(this.counter++);
    const path = `users/${userId}/backupSnapshots/${id}`;
    const savedAt = this.savedAtQueue.shift() ?? payload.createdAt;
    this.snapshots.push({ ...payload, id, savedAt });
    this.activeSnapshotIdsByUser.set(userId, id);

    const currentMemos = this.currentMemosByUser.get(userId) ?? new Map();
    for (const memo of payload.memos) {
      if (memo.deletedAt !== null) continue;
      currentMemos.set(memo.id, { memo, savedAt, snapshotId: id });
    }
    this.currentMemosByUser.set(userId, currentMemos);
    return {
      path,
      snapshotId: id,
      outcome: "created",
      cleanupPending: false,
    };
  }

  async loadLatestBackup(userId: string): Promise<unknown | null> {
    const matching = this.snapshots.filter((snapshot) => snapshot.userId === userId);
    return matching[matching.length - 1] ?? null;
  }

  async loadBackups(userId: string): Promise<unknown[]> {
    this.snapshotLoadCount += 1;
    return this.snapshots.filter((snapshot) => snapshot.userId === userId).reverse();
  }

  async loadCurrentMemos(userId: string): Promise<StoredCurrentMemo[]> {
    this.currentMemoLoadCount += 1;
    return [...(this.currentMemosByUser.get(userId)?.values() ?? [])];
  }

  async loadDeletedMemoIds(userId: string): Promise<string[]> {
    const activeSnapshotId = this.activeSnapshotIdsByUser.get(userId);
    return [...(this.deletedMemoSnapshotsByUser.get(userId) ?? new Map())]
      .filter(([, snapshotId]) => snapshotId === activeSnapshotId)
      .map(([memoId]) => memoId);
  }

  async deleteCurrentMemo(userId: string, memoId: string): Promise<number> {
    const deletedMemoSnapshots = this.deletedMemoSnapshotsByUser.get(userId) ?? new Map<string, string>();
    const activeSnapshotId = this.activeSnapshotIdsByUser.get(userId);
    if (activeSnapshotId) deletedMemoSnapshots.set(memoId, activeSnapshotId);
    this.deletedMemoSnapshotsByUser.set(userId, deletedMemoSnapshots);
    this.currentMemosByUser.get(userId)?.delete(memoId);
    return 1;
  }

  async deleteMemoFromBackups(): Promise<number> {
    this.legacySnapshotMutationCount += 1;
    throw new Error("immutable snapshot history must not be rewritten");
  }
}

export { FakeFirestoreDriver as FakeFirestoreBackupDriver };
