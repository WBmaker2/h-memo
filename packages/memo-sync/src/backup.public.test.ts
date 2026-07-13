import { describe, expect, it } from "vitest";
import {
  createMemo,
  loadRestoreSafetyPoint,
  saveRestoreSafetyPoint,
  validateBackupPayload,
} from "@h-memo/memo-core";
import {
  FirestoreBackupGateway,
  backupMemos,
  encodeMemoDocumentId,
  deleteBackedUpMemo,
  listBackupSnapshots,
  listBackedUpMemos,
  type BackupGateway,
  type MemoBackupPayload,
  type StoredCurrentMemo,
  restoreLatestBackup,
} from "./backup";
import {
  createStorage,
  FakeBackupGateway,
  FakeFirestoreDriver,
  FakeTimestamp,
} from "./testing/fakeFirestoreBackupDriver";

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

  it("keeps a pre-branch inline legacy snapshot with malformed timestamps readable", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = new FirestoreBackupGateway({} as never, driver as never);
    const legacyMemo = {
      ...createMemo({
        id: "legacy-malformed-time",
        now: "2026-05-13T09:00:00.000Z",
        plainText: "시간 메타데이터 보존",
      }),
      createdAt: "",
      updatedAt: "legacy non-ISO time",
      deletedAt: "legacy deleted-at metadata",
    };
    driver.seed("users/user-1/backupSnapshots/legacy-inline", {
      version: 1,
      userId: "user-1",
      createdAt: "",
      memos: [legacyMemo],
      savedAt: "",
    });

    const backups = await gateway.loadBackups("user-1");
    const restored = await restoreLatestBackup(gateway, "user-1");
    const snapshots = await listBackupSnapshots(gateway, "user-1");

    expect(backups).toHaveLength(1);
    expect(restored?.memos[0]).toMatchObject({
      id: legacyMemo.id,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      deletedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns a legacy restore payload that passes strict validation, rebackup, and safety-point creation", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = new FirestoreBackupGateway({} as never, driver as never);
    const legacyMemo = createMemo({
      id: "legacy-recoverable",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "다시 백업할 레거시 메모",
    });
    driver.seed("users/user-1/backupSnapshots/legacy-inline", {
      version: 1,
      userId: "user-1",
      createdAt: "",
      memos: [{ ...legacyMemo, createdAt: "", updatedAt: "legacy time" }],
      savedAt: "",
    });

    const restored = await restoreLatestBackup(gateway, "user-1");

    expect(restored).not.toBeNull();
    expect(validateBackupPayload(restored, "user-1")).toEqual({
      ok: true,
      payload: restored,
    });

    const storage = createStorage();
    expect(() =>
      saveRestoreSafetyPoint(storage, {
        version: 1,
        source: "server",
        createdAt: "2026-05-13T09:05:00.000Z",
        payload: restored!,
      })
    ).not.toThrow();
    expect(loadRestoreSafetyPoint(storage)?.payload).toEqual(restored);
    await expect(gateway.saveBackup("user-1", restored!)).resolves.toContain(
      "backupSnapshots"
    );
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
