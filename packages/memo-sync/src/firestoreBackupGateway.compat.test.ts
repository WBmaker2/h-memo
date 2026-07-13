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

function snapshotId(path: string | { snapshotId: string }) {
  return typeof path === "string" ? path.split("/").at(-1)! : path.snapshotId;
}

describe("FirestoreBackupGateway compatibility contract", () => {
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
      active: {
        snapshotId: "snapshot-current",
        savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
      },
      pending: null,
    });
    driver.seed("users/user-1/memos/past", {
      userId: "user-1",
      memoId: "past",
      active: {
        snapshotId: "snapshot-current",
        savedAt: new FakeTimestamp("2026-05-13T09:02:00.000Z"),
      },
      pending: null,
    });
    driver.seed("users/user-1/backupSnapshots/snapshot-current", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memoCount: 2,
      state: "complete",
      savedAt: new FakeTimestamp("2026-05-13T09:03:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/snapshot-current/memos/future", {
      userId: "user-1",
      memoId: "future",
      memo: clientFuture,
    });
    driver.seed("users/user-1/backupSnapshots/snapshot-current/memos/past", {
      userId: "user-1",
      memoId: "past",
      memo: clientPast,
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

  it("keeps canonical documents bounded across repeated backups and a failed generation", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-bounded", now: "2026-05-13T09:00:00.000Z" });

    const first = snapshotId(await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [memo],
    }));
    const second = snapshotId(await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:01:00.000Z",
      memos: [{ ...memo, plainText: "second" }],
    }));
    const third = snapshotId(await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:02:00.000Z",
      memos: [{ ...memo, plainText: "third" }],
    }));
    driver.failTransactionCommit = driver.transactionCommitCount + 3;

    await expect(gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:03:00.000Z",
      memos: [{ ...memo, plainText: "failed fourth" }],
    })).rejects.toThrow("forced transaction failure");

    const canonical = driver.read("users/user-1/memosV2/memo-bounded");
    expect(canonical).toEqual(expect.objectContaining({
      userId: "user-1",
      memoId: "memo-bounded",
      active: expect.objectContaining({ snapshotId: third }),
      pending: expect.objectContaining({ snapshotId: "4" }),
    }));
    expect(Object.keys(canonical ?? {}).sort()).toEqual(["active", "memoId", "pending", "userId"]);
    expect(canonical).not.toHaveProperty("memo");
    expect(canonical).not.toHaveProperty("generations");
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.plainText)).toEqual([
      "third",
    ]);
  });

  it("keeps per-memo and legacy tombstones effective until the active generation contains that memo", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-tombstone", now: "2026-05-13T09:00:00.000Z" });
    const legacyMemo = createMemo({ id: "memo-legacy-tombstone", now: "2026-05-13T09:00:00.000Z" });

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [memo, legacyMemo],
    });
    await gateway.deleteCurrentMemo("user-1", memo.id);
    driver.seed("users/user-1/serverMemoDeletes/memo-legacy-tombstone", {
      userId: "user-1",
      memoId: legacyMemo.id,
      deletedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
    });

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:02:00.000Z",
      memos: [],
    });

    expect((await listBackupSnapshots(gateway, "user-1")).flatMap((snapshot) =>
      snapshot.payload.memos.map((item) => item.id)
    )).not.toContain(memo.id);
    expect((await listBackupSnapshots(gateway, "user-1")).flatMap((snapshot) =>
      snapshot.payload.memos.map((item) => item.id)
    )).not.toContain(legacyMemo.id);

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:03:00.000Z",
      memos: [memo, legacyMemo],
    });

    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id).sort()).toEqual([
      legacyMemo.id,
      memo.id,
    ]);
    expect(await gateway.loadDeletedMemoIds("user-1")).toEqual([]);
    expect((await listBackupSnapshots(gateway, "user-1")).flatMap((snapshot) =>
      snapshot.payload.memos.map((item) => item.id)
    )).toEqual(expect.arrayContaining([memo.id, legacyMemo.id]));
  });

});
