import { describe, expect, it } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  FirestoreBackupGateway,
  backupMemos,
  deleteBackedUpMemo,
  listBackupSnapshots,
  listBackedUpMemos,
  type BackupGateway,
  type MemoBackupPayload,
  type StoredCurrentMemo,
  restoreLatestBackup,
} from "./backup";

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

class FakeTimestamp {
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
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

class FakeFirestoreDriver {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly batchOperationCounts: number[] = [];
  private readonly versions = new Map<string, number>();
  private nextDocument = 1;
  private nextTimestamp = 1;
  private batchCommits = 0;
  failBatchCommit: number | null = null;
  beforeBatchCommit: ((operations: DriverOperation[]) => Promise<void>) | null = null;
  onFirstTransactionRead: (() => Promise<void>) | null = null;
  private usedTransactionReadHook = false;

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
      };
      const result = await updater(transaction);
      if (!this.usedTransactionReadHook && reads.size > 0 && this.onFirstTransactionRead) {
        this.usedTransactionReadHook = true;
        await this.onFirstTransactionRead();
      }
      const conflicted = [...reads].some(
        ([path, version]) => (this.versions.get(path) ?? 0) !== version
      );
      if (conflicted) {
        continue;
      }
      this.apply(operations);
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
    if (value === SERVER_TIMESTAMP) {
      const timestamp = new Date(Date.UTC(2026, 4, 13, 9, 0, this.nextTimestamp++));
      return new FakeTimestamp(timestamp.toISOString());
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item));
    }
    if (isPlainRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolveValue(item)]));
    }
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
      if (!isPlainRecord(cursor[segment])) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    if (value === DELETE_FIELD) {
      delete cursor[last];
    } else {
      cursor[last] = cloneValue(value);
    }
  }

  private bump(path: string) {
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
  }
}

type StoredPayload = MemoBackupPayload & {
  id: string;
  savedAt?: string;
};

class FakeBackupGateway implements BackupGateway {
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

  async saveBackup(userId: string, payload: MemoBackupPayload): Promise<string> {
    const id = String(this.counter++);
    const path = `users/${userId}/backupSnapshots/${id}`;
    const savedAt = this.savedAtQueue.shift() ?? payload.createdAt;
    this.snapshots.push({ ...payload, id, savedAt });
    this.activeSnapshotIdsByUser.set(userId, id);

    const currentMemos = this.currentMemosByUser.get(userId) ?? new Map();
    for (const memo of payload.memos) {
      if (memo.deletedAt !== null) {
        continue;
      }
      currentMemos.set(memo.id, { memo, savedAt, snapshotId: id });
    }
    this.currentMemosByUser.set(userId, currentMemos);
    return path;
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
    if (activeSnapshotId) {
      deletedMemoSnapshots.set(memoId, activeSnapshotId);
    }
    this.deletedMemoSnapshotsByUser.set(userId, deletedMemoSnapshots);
    this.currentMemosByUser.get(userId)?.delete(memoId);
    return 1;
  }

  async deleteMemoFromBackups(): Promise<number> {
    this.legacySnapshotMutationCount += 1;
    throw new Error("immutable snapshot history must not be rewritten");
  }
}

describe("memo-sync backup", () => {
  it("stores a version-1 local payload while returning the snapshot path", async () => {
    const gateway = new FakeBackupGateway();
    const memos = [createMemo({ id: "memo-1", now: "2026-05-13T09:00:00.000Z" })];

    const result = await backupMemos(
      gateway,
      "user-1",
      memos,
      "2026-05-13T09:05:00.000Z"
    );

    expect(result.path).toBe("users/user-1/backupSnapshots/1");
    expect(result.payload.version).toBe(1);
    expect(result.payload.userId).toBe("user-1");
    expect(result.payload.createdAt).toBe("2026-05-13T09:05:00.000Z");
    expect(result.payload.memos).toEqual(memos);
  });

  it("restores the latest complete backup after validating its version-1 payload", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";

    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-old", now: "2026-05-13T09:00:00.000Z" })],
      "2026-05-13T09:01:00.000Z"
    );
    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-new", now: "2026-05-13T09:02:00.000Z" })],
      "2026-05-13T09:03:00.000Z"
    );

    const restored = await restoreLatestBackup(gateway, userId);

    expect(restored).not.toBeNull();
    expect(restored?.version).toBe(1);
    expect(restored?.memos[0]?.id).toBe("memo-new");
  });

  it("orders backup history by normalized server savedAt instead of skewed client createdAt", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    gateway.queueServerSavedAt("2026-05-13T09:10:00.000Z");
    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-client-future", now: "2030-01-01T00:00:00.000Z" })],
      "2030-01-01T00:00:00.000Z"
    );
    gateway.queueServerSavedAt("2026-05-13T09:20:00.000Z");
    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-client-past", now: "2020-01-01T00:00:00.000Z" })],
      "2020-01-01T00:00:00.000Z"
    );

    const snapshots = await listBackupSnapshots(gateway, userId);

    expect(snapshots.map((snapshot) => snapshot.createdAt)).toEqual([
      "2026-05-13T09:20:00.000Z",
      "2026-05-13T09:10:00.000Z",
    ]);
    expect(snapshots.map((snapshot) => snapshot.payload.createdAt)).toEqual([
      "2020-01-01T00:00:00.000Z",
      "2030-01-01T00:00:00.000Z",
    ]);
  });

  it("ignores an incomplete schema-v2 snapshot when restoring the latest backup", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    await backupMemos(
      gateway,
      userId,
      [createMemo({ id: "memo-complete", now: "2026-05-13T09:00:00.000Z" })],
      "2026-05-13T09:01:00.000Z"
    );
    gateway.addIncompleteSnapshot(userId, "2026-05-13T09:02:00.000Z");

    const restored = await restoreLatestBackup(gateway, userId);

    expect(restored?.memos.map((memo) => memo.id)).toEqual(["memo-complete"]);
  });

  it("lists canonical current memos without scanning historical snapshots", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const memo = createMemo({ id: "memo-current", now: "2026-05-13T09:00:00.000Z" });
    await backupMemos(gateway, userId, [memo], "2026-05-13T09:01:00.000Z");
    await backupMemos(
      gateway,
      userId,
      [{ ...memo, plainText: "newer canonical value", updatedAt: "2026-05-13T09:02:00.000Z" }],
      "2026-05-13T09:03:00.000Z"
    );

    const backedUpMemos = await listBackedUpMemos(gateway, userId);

    expect(backedUpMemos).toHaveLength(1);
    expect(backedUpMemos[0]?.memo.plainText).toBe("newer canonical value");
    expect(gateway.currentMemoLoadCount).toBe(1);
    expect(gateway.snapshotLoadCount).toBe(0);
  });

  it("deletes only the canonical memo, writes a tombstone, and leaves immutable history intact", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const keepMemo = createMemo({ id: "memo-keep", now: "2026-05-13T09:00:00.000Z" });
    const removeMemo = createMemo({ id: "memo-remove", now: "2026-05-13T09:01:00.000Z" });
    await backupMemos(gateway, userId, [keepMemo, removeMemo], "2026-05-13T09:02:00.000Z");
    const historicalMemoIds = gateway.snapshotMemoIds();

    const deletedCount = await deleteBackedUpMemo(gateway, userId, "memo-remove");

    expect(deletedCount).toBe(1);
    expect(gateway.currentMemoIds(userId)).toEqual(["memo-keep"]);
    expect(await gateway.loadDeletedMemoIds(userId)).toEqual(["memo-remove"]);
    expect(gateway.snapshotMemoIds()).toEqual(historicalMemoIds);
    expect(gateway.legacySnapshotMutationCount).toBe(0);
  });

  it("keeps tombstoned memos out of a complete historical restore", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const keepMemo = createMemo({ id: "memo-keep", now: "2026-05-13T09:00:00.000Z" });
    const removeMemo = createMemo({ id: "memo-remove", now: "2026-05-13T09:01:00.000Z" });
    await backupMemos(gateway, userId, [keepMemo, removeMemo], "2026-05-13T09:02:00.000Z");

    await deleteBackedUpMemo(gateway, userId, "memo-remove");
    const restored = await restoreLatestBackup(gateway, userId);

    expect(restored?.memos.map((memo) => memo.id)).toEqual(["memo-keep"]);
  });

  it("clears a memo tombstone after a later successful active backup", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const memo = createMemo({ id: "memo-restore", now: "2026-05-13T09:00:00.000Z" });
    await backupMemos(gateway, userId, [memo], "2026-05-13T09:01:00.000Z");
    await deleteBackedUpMemo(gateway, userId, "memo-restore");

    await backupMemos(
      gateway,
      userId,
      [{ ...memo, plainText: "backed up again", updatedAt: "2026-05-13T09:02:00.000Z" }],
      "2026-05-13T09:03:00.000Z"
    );

    expect(await gateway.loadDeletedMemoIds(userId)).toEqual([]);
    expect((await listBackedUpMemos(gateway, userId)).map((item) => item.memo.id)).toEqual([
      "memo-restore",
    ]);
  });

  it("restores an inline version-1 legacy snapshot with its client createdAt fallback", async () => {
    const gateway = new FakeBackupGateway();
    const userId = "user-1";
    const memo = createMemo({ id: "legacy-memo", now: "2026-05-13T09:00:00.000Z" });
    await backupMemos(gateway, userId, [memo], "2026-05-13T09:01:00.000Z");

    const restored = await restoreLatestBackup(gateway, userId);
    const snapshots = await listBackupSnapshots(gateway, userId);

    expect(restored?.memos.map((item) => item.id)).toEqual(["legacy-memo"]);
    expect(snapshots[0]?.createdAt).toBe("2026-05-13T09:01:00.000Z");
  });

  it("rejects an invalid backup payload", async () => {
    class InvalidPayloadGateway implements BackupGateway {
      async saveBackup(): Promise<string> {
        return "";
      }

      async loadLatestBackup(): Promise<unknown | null> {
        return {
          version: 2,
          userId: "user-1",
          createdAt: "2026-05-13T09:00:00.000Z",
          memos: [],
        };
      }

      async loadBackups(): Promise<unknown[]> {
        return [await this.loadLatestBackup()];
      }

      async loadCurrentMemos(): Promise<StoredCurrentMemo[]> {
        return [];
      }

      async loadDeletedMemoIds(): Promise<string[]> {
        return [];
      }

      async deleteCurrentMemo(): Promise<number> {
        return 0;
      }
    }

    await expect(restoreLatestBackup(new InvalidPayloadGateway(), "user-1")).rejects.toThrow(
      "지원하지 않는 백업 버전입니다."
    );
  });
});

describe("FirestoreBackupGateway driver contract", () => {
  function createGateway(driver: FakeFirestoreDriver) {
    return new FirestoreBackupGateway({} as never, driver as never);
  }

  function snapshotId(path: string) {
    return path.split("/").at(-1)!;
  }

  it("writes more than 200 memos in bounded batches and activates only after the snapshot is complete", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memos = Array.from({ length: 201 }, (_, index) =>
      createMemo({ id: `memo-${index}`, now: "2026-05-13T09:00:00.000Z" })
    );

    const path = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2030-01-01T00:00:00.000Z",
      memos,
    });
    const id = snapshotId(path);

    expect(driver.batchOperationCounts.slice(0, 2)).toEqual([400, 2]);
    expect(driver.batchOperationCounts.every((count) => count <= 400)).toBe(true);
    expect(driver.read(`users/user-1/backupSnapshots/${id}`)).toMatchObject({
      schemaVersion: 2,
      state: "complete",
      memoCount: 201,
    });
    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: id,
    });
    expect(driver.read("users/user-1/memos/memo-0")).toMatchObject({
      userId: "user-1",
      memoId: "memo-0",
      generations: {
        [id]: {
          snapshotId: id,
          savedAt: expect.any(FakeTimestamp),
        },
      },
    });
    const currentMemos = await gateway.loadCurrentMemos("user-1");
    expect(currentMemos.map((entry) => entry.memo.id)).toHaveLength(201);
    expect(currentMemos[0]).toMatchObject({ snapshotId: id });
    expect(currentMemos[0]?.savedAt).toMatch(/2026-05-13T09:00:/);
  });

  it("keeps the previous complete generation and tombstones authoritative when a later memo chunk fails", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const previous = createMemo({ id: "memo-previous", now: "2026-05-13T09:00:00.000Z" });
    const firstPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [previous],
    });
    await gateway.deleteCurrentMemo("user-1", previous.id);
    driver.failBatchCommit = driver.batchOperationCounts.length + 2;

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:05:00.000Z",
        memos: Array.from({ length: 201 }, (_, index) =>
          createMemo({ id: `memo-new-${index}`, now: "2026-05-13T09:05:00.000Z" })
        ),
      })
    ).rejects.toThrow("forced batch failure");

    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(firstPath),
    });
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toEqual([]);
    expect(await gateway.loadDeletedMemoIds("user-1")).toEqual([previous.id]);
  });

  it("leaves an activation-failed snapshot in writing without changing the active generation", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const previous = createMemo({ id: "memo-previous", now: "2026-05-13T09:00:00.000Z" });
    const previousPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [previous],
    });
    driver.failBatchCommit = driver.batchOperationCounts.length + 2;

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:05:00.000Z",
        memos: [createMemo({ id: "memo-next", now: "2026-05-13T09:05:00.000Z" })],
      })
    ).rejects.toThrow("forced batch failure");

    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(previousPath),
    });
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toEqual([
      previous.id,
    ]);
    expect(driver.read("users/user-1/backupSnapshots/2")).toMatchObject({ state: "writing" });
  });

  it("reactivates only through final generation activation when deletion wins before activation", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-race", now: "2026-05-13T09:00:00.000Z" });
    const firstPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [memo],
    });
    let deletedDuringActivation = false;
    driver.beforeBatchCommit = async (operations) => {
      const activatesGeneration = operations.some(
        (operation) => operation.ref.path === "users/user-1/backupState/current"
      );
      if (activatesGeneration && !deletedDuringActivation) {
        deletedDuringActivation = true;
        await gateway.deleteCurrentMemo("user-1", memo.id);
      }
    };

    const secondPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:10:00.000Z",
      memos: [{ ...memo, plainText: "reactivated" }],
    });

    expect(snapshotId(secondPath)).not.toBe(snapshotId(firstPath));
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.plainText)).toEqual([
      "reactivated",
    ]);
    expect(await gateway.loadDeletedMemoIds("user-1")).toEqual([]);
  });

  it("retries a server delete against the generation activated during its transaction", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-delete", now: "2026-05-13T09:00:00.000Z" });
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "snapshot-a",
      activatedAt: new FakeTimestamp("2026-05-13T09:00:00.000Z"),
    });
    driver.seed("users/user-1/memos/memo-delete", {
      userId: "user-1",
      memoId: "memo-delete",
      generations: {
        "snapshot-a": { snapshotId: "snapshot-a", memo, savedAt: new FakeTimestamp("2026-05-13T09:00:00.000Z") },
        "snapshot-b": { snapshotId: "snapshot-b", memo, savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z") },
      },
    });
    driver.onFirstTransactionRead = async () => {
      driver.seed("users/user-1/backupState/current", {
        userId: "user-1",
        activeSnapshotId: "snapshot-b",
        activatedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
      });
    };

    await gateway.deleteCurrentMemo("user-1", memo.id);

    expect(driver.read("users/user-1/serverMemoDeletes/memo-delete")).toMatchObject({
      snapshotId: "snapshot-b",
    });
    expect(await gateway.loadCurrentMemos("user-1")).toEqual([]);
  });

  it("uses Timestamp server savedAt to order canonical memos instead of skewed memo clocks", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const clientFuture = createMemo({ id: "future", now: "2030-01-01T00:00:00.000Z" });
    const clientPast = createMemo({ id: "past", now: "2020-01-01T00:00:00.000Z" });
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "snapshot-current",
      activatedAt: new FakeTimestamp("2026-05-13T09:00:00.000Z"),
    });
    driver.seed("users/user-1/memos/future", {
      userId: "user-1",
      memoId: "future",
      generations: {
        "snapshot-current": {
          snapshotId: "snapshot-current",
          memo: clientFuture,
          savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
        },
      },
    });
    driver.seed("users/user-1/memos/past", {
      userId: "user-1",
      memoId: "past",
      generations: {
        "snapshot-current": {
          snapshotId: "snapshot-current",
          memo: clientPast,
          savedAt: new FakeTimestamp("2026-05-13T09:02:00.000Z"),
        },
      },
    });

    const memos = await listBackedUpMemos(gateway, "user-1");

    expect(memos.map((entry) => entry.memo.id)).toEqual(["past", "future"]);
    expect(memos.map((entry) => entry.backupCreatedAt)).toEqual([
      "2026-05-13T09:02:00.000Z",
      "2026-05-13T09:01:00.000Z",
    ]);
  });

  it("rejects complete snapshots with missing, extra, or malformed memo wrappers without partial restore", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-valid", now: "2026-05-13T09:00:00.000Z" });
    const seedSnapshot = (id: string, memoCount: number) => {
      driver.seed(`users/user-1/backupSnapshots/${id}`, {
        schemaVersion: 2,
        userId: "user-1",
        createdAt: "2026-05-13T09:00:00.000Z",
        memoCount,
        state: "complete",
        savedAt: new FakeTimestamp("2026-05-13T09:05:00.000Z"),
      });
    };
    seedSnapshot("missing", 1);
    seedSnapshot("extra", 1);
    driver.seed("users/user-1/backupSnapshots/extra/memos/memo-valid", {
      userId: "user-1",
      memoId: "memo-valid",
      memo,
    });
    driver.seed("users/user-1/backupSnapshots/extra/memos/memo-extra", {
      userId: "user-1",
      memoId: "memo-extra",
      memo: { ...memo, id: "memo-extra" },
    });
    seedSnapshot("malformed", 1);
    driver.seed("users/user-1/backupSnapshots/malformed/memos/memo-valid", {
      userId: "another-user",
      memoId: "memo-valid",
      memo,
    });

    expect(await gateway.loadBackups("user-1")).toEqual([]);
  });
});
