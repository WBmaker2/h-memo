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

function createGateway(driver: FakeFirestoreDriver) {
  return new FirestoreBackupGateway({} as never, driver as never);
}

function snapshotId(path: string) {
  return path.split("/").at(-1)!;
}

describe("FirestoreBackupGateway failure contract", () => {
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
    driver.failTransactionCommit = driver.transactionCommitCount + 3;

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:05:00.000Z",
        memos: Array.from({ length: 201 }, (_, index) =>
          createMemo({ id: `memo-new-${index}`, now: "2026-05-13T09:05:00.000Z" })
        ),
      })
    ).rejects.toThrow("forced transaction failure");

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
    driver.failTransactionCommit = driver.transactionCommitCount + 3;

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:05:00.000Z",
        memos: [createMemo({ id: "memo-next", now: "2026-05-13T09:05:00.000Z" })],
      })
    ).rejects.toThrow("forced transaction failure");

    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(previousPath),
    });
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toEqual([
      previous.id,
    ]);
    expect(driver.read("users/user-1/backupSnapshots/2")).toMatchObject({ state: "writing" });
  });

  it("keeps a same-ID tombstone when backup activation fails before it becomes active", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-failed-rebackup", now: "2026-05-13T09:00:00.000Z" });
    const firstPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [memo],
    });
    await gateway.deleteCurrentMemo("user-1", memo.id);
    const tombstonePath = `users/user-1/serverMemoDeletesV2/${encodeMemoDocumentId(memo.id)}`;
    driver.failTransactionCommit = driver.transactionCommitCount + 3;

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:03:00.000Z",
        memos: [{ ...memo, plainText: "failed rebackup" }],
      })
    ).rejects.toThrow("forced transaction failure");

    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(firstPath),
    });
    expect(driver.read(tombstonePath)).toMatchObject({
      memoId: memo.id,
      snapshotId: snapshotId(firstPath),
    });
    expect(await gateway.loadDeletedMemoIds("user-1")).toEqual([memo.id]);
    expect((await restoreLatestBackup(gateway, "user-1"))?.memos).toEqual([]);
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
    driver.beforeTransactionCommit = async (operations) => {
      const activatesGeneration = operations.some(
        (operation) =>
          operation.ref.path === "users/user-1/backupState/current" &&
          operation.data?.activeSnapshotId === "2" &&
          operation.data?.pendingSnapshotId === null
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
    expect(deletedDuringActivation).toBe(true);
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
      pendingSnapshotId: null,
      activatedAt: new FakeTimestamp("2026-05-13T09:00:00.000Z"),
    });
    driver.seed("users/user-1/memos/memo-delete", {
      userId: "user-1",
      memoId: "memo-delete",
      active: { snapshotId: "snapshot-a", savedAt: new FakeTimestamp("2026-05-13T09:00:00.000Z") },
      pending: { snapshotId: "snapshot-b", savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z") },
    });
    driver.onFirstTransactionRead = async () => {
      driver.seed("users/user-1/backupState/current", {
        userId: "user-1",
        activeSnapshotId: "snapshot-b",
        pendingSnapshotId: null,
        activatedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
      });
    };

    await gateway.deleteCurrentMemo("user-1", memo.id);

    expect(driver.read("users/user-1/serverMemoDeletesV2/memo-delete")).toMatchObject({
      snapshotId: "snapshot-b",
    });
    expect(await gateway.loadCurrentMemos("user-1")).toEqual([]);
  });

});
