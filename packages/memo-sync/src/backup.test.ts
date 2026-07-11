import { describe, expect, it } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  backupMemos,
  deleteBackedUpMemo,
  listBackupSnapshots,
  listBackedUpMemos,
  type BackupGateway,
  type MemoBackupPayload,
  restoreLatestBackup,
} from "./backup";

type StoredPayload = MemoBackupPayload & {
  id: string;
  savedAt?: string;
};

class FakeBackupGateway implements BackupGateway {
  private snapshots: StoredPayload[] = [];
  private currentMemosByUser = new Map<string, Map<string, MemoBackupPayload["memos"][number]>>();
  private deletedMemoIdsByUser = new Map<string, Set<string>>();
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

    const currentMemos = this.currentMemosByUser.get(userId) ?? new Map();
    for (const memo of payload.memos) {
      if (memo.deletedAt !== null) {
        continue;
      }
      currentMemos.set(memo.id, memo);
      this.deletedMemoIdsByUser.get(userId)?.delete(memo.id);
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

  async loadCurrentMemos(userId: string): Promise<MemoBackupPayload["memos"]> {
    this.currentMemoLoadCount += 1;
    return [...(this.currentMemosByUser.get(userId)?.values() ?? [])];
  }

  async loadDeletedMemoIds(userId: string): Promise<string[]> {
    return [...(this.deletedMemoIdsByUser.get(userId) ?? new Set<string>())];
  }

  async deleteCurrentMemo(userId: string, memoId: string): Promise<number> {
    const deletedMemoIds = this.deletedMemoIdsByUser.get(userId) ?? new Set<string>();
    deletedMemoIds.add(memoId);
    this.deletedMemoIdsByUser.set(userId, deletedMemoIds);
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

      async loadCurrentMemos(): Promise<MemoBackupPayload["memos"]> {
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
