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

describe("FirestoreBackupGateway concurrency contract", () => {
  it("clears the pending lease only when its backup activates", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-lease", now: "2026-05-13T09:00:00.000Z" });

    const path = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [memo],
    });

    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(path),
      pendingSnapshotId: null,
    });
    expect(driver.transactionOperationCounts).toEqual([2, 2, 2]);
    expect(driver.read(`users/user-1/backupSnapshots/${snapshotId(path)}/memosV2/${memo.id}`)).toMatchObject({
      memoId: memo.id,
    });
  });

  it("keeps the prior generation authoritative when a newer lease supersedes an older backup", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const priorMemo = createMemo({ id: "memo-prior", now: "2026-05-13T09:00:00.000Z" });
    const priorPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [priorMemo],
    });
    let newerBackupStarted = false;
    driver.afterTransactionCommit = async (operations) => {
      const acquiredOlderLease = operations.some(
        (operation) =>
          operation.ref.path === "users/user-1/backupState/current" &&
          operation.data?.pendingSnapshotId === "2"
      );
      if (!acquiredOlderLease || newerBackupStarted) {
        return;
      }

      newerBackupStarted = true;
      driver.failTransactionCommit = driver.transactionCommitCount + 3;
      await expect(
        gateway.saveBackup("user-1", {
          version: 1,
          userId: "user-1",
          createdAt: "2026-05-13T09:02:00.000Z",
          memos: [
            createMemo({ id: "memo-newer", now: "2026-05-13T09:02:00.000Z" }),
          ],
        })
      ).rejects.toThrow("forced transaction failure");
    };

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:01:00.000Z",
        memos: [
          createMemo({ id: "memo-older", now: "2026-05-13T09:01:00.000Z" }),
        ],
      })
    ).rejects.toThrow("superseded");

    expect(newerBackupStarted).toBe(true);
    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(priorPath),
      pendingSnapshotId: "3",
    });
    expect(driver.read("users/user-1/backupSnapshots/2/memosV2/memo-older")).toBeUndefined();
    expect(driver.read("users/user-1/backupSnapshots/3/memosV2/memo-newer")).toMatchObject({
      memoId: "memo-newer",
    });
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toEqual([
      priorMemo.id,
    ]);
  });

  it("retries staging after a concurrent deletion without restoring its stale active reference", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-stale-read", now: "2026-05-13T09:00:00.000Z" });
    const priorPath = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [memo],
    });
    let deletedDuringStaging = false;
    driver.beforeTransactionCommit = async (operations) => {
      const stagesMemo = operations.some(
        (operation) =>
          operation.ref.path === "users/user-1/backupSnapshots/2/memosV2/memo-stale-read"
      );
      if (!stagesMemo || deletedDuringStaging) {
        return;
      }

      deletedDuringStaging = true;
      await gateway.deleteCurrentMemo("user-1", memo.id);
      driver.failTransactionCommit = driver.transactionCommitCount + 2;
    };

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:01:00.000Z",
        memos: [{ ...memo, plainText: "staged after delete" }],
      })
    ).rejects.toThrow("forced transaction failure");

    expect(deletedDuringStaging).toBe(true);
    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: snapshotId(priorPath),
      pendingSnapshotId: "2",
    });
    expect(driver.read("users/user-1/memosV2/memo-stale-read")).toMatchObject({
      active: null,
      pending: { snapshotId: "2" },
    });
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toEqual([]);
    expect(await gateway.loadDeletedMemoIds("user-1")).toEqual([memo.id]);
  });

  it("rejects duplicate active memo IDs before writing backup state", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-duplicate", now: "2026-05-13T09:00:00.000Z" });

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:01:00.000Z",
        memos: [memo, { ...memo, plainText: "duplicate" }],
      })
    ).rejects.toThrow("Duplicate active memo ID");

    expect(driver.docs).toEqual(new Map());
    expect(driver.transactionOperationCounts).toEqual([]);
  });
});
