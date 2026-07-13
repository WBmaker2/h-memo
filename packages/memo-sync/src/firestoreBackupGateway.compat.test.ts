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
  listBackupSnapshotSummaries,
  listBackupSnapshots,
  listBackedUpMemos,
  loadBackupSnapshot,
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
  it("lists v2 and v3 history without reading snapshot memo subcollections", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.seed("users/user-1/backupSnapshots/v2", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "2026-05-12T09:00:00.000Z",
      memoCount: 1,
      state: "complete",
      savedAt: new FakeTimestamp("2026-05-12T09:01:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/v3", {
      schemaVersion: 3,
      userId: "user-1",
      clientCreatedAt: "2026-05-13T09:00:00.000Z",
      memoCount: 1,
      contentHash: "b".repeat(64),
      previewText: "최신 백업",
      state: "complete",
      savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
    });
    driver.readCollectionPaths.length = 0;

    const summaries = await listBackupSnapshotSummaries(
      gateway,
      "user-1",
      "2026-05-13T10:00:00.000Z"
    );

    expect(summaries).toHaveLength(2);
    expect(driver.readCollectionPaths).not.toContainEqual(
      expect.stringMatching(/backupSnapshots\/[^/]+\/memos(V2|V3)?$/)
    );
  });

  it("lists a v2 snapshot by its createdAt when server savedAt is missing", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.seed("users/user-1/backupSnapshots/v2-created-at", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "2026-05-12T09:00:00.000Z",
      memoCount: 1,
      state: "complete",
    });

    const summaries = await listBackupSnapshotSummaries(
      gateway,
      "user-1",
      "2026-05-13T10:00:00.000Z"
    );

    expect(summaries).toMatchObject([{
      id: "v2-created-at",
      savedAt: "2026-05-12T09:00:00.000Z",
      kstDate: "2026-05-12",
      legacyUndated: false,
    }]);
  });

  it("loads and validates only the selected snapshot payload", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const selectedMemo = createMemo({
      id: "selected-memo",
      plainText: "선택 메모",
      now: "2026-05-13T09:00:00.000Z",
    });
    const otherMemo = createMemo({ id: "other-memo", now: "2026-05-13T09:00:00.000Z" });
    for (const [id, memo] of [["selected", selectedMemo], ["other", otherMemo]] as const) {
      driver.seed(`users/user-1/backupSnapshots/${id}`, {
        schemaVersion: 3,
        userId: "user-1",
        clientCreatedAt: "2026-05-13T09:00:00.000Z",
        memoCount: 1,
        contentHash: "c".repeat(64),
        previewText: memo.plainText,
        state: "complete",
        savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
      });
      driver.seed(`users/user-1/backupSnapshots/${id}/memosV3/${encodeMemoDocumentId(memo.id)}`, {
        userId: "user-1",
        memoId: memo.id,
        memo,
      });
    }
    driver.readCollectionPaths.length = 0;

    const payload = await loadBackupSnapshot(gateway, "user-1", "selected");

    expect(payload?.memos[0]?.plainText).toBe("선택 메모");
    expect(driver.readCollectionPaths).toContain(
      "users/user-1/backupSnapshots/selected/memosV3"
    );
    expect(driver.readCollectionPaths).not.toContain(
      "users/user-1/backupSnapshots/other/memosV3"
    );
  });

  it("restores a selected v2 snapshot without server savedAt", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({
      id: "legacy-v2-memo",
      plainText: "서버 시각 없는 v2",
      now: "2026-05-12T08:59:00.000Z",
    });
    driver.seed("users/user-1/backupSnapshots/v2-created-at", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "2026-05-12T09:00:00+09:00",
      memoCount: 1,
      state: "complete",
    });
    driver.seed("users/user-1/backupSnapshots/v2-created-at/memos/legacy-v2-memo", {
      userId: "user-1",
      memoId: memo.id,
      memo,
    });

    const payload = await loadBackupSnapshot(gateway, "user-1", "v2-created-at");

    expect(payload?.memos.map((item) => item.id)).toEqual([memo.id]);
    expect(payload?.createdAt).toBe("2026-05-12T00:00:00.000Z");
  });

  it("rejects a selected v2 snapshot with an invalid createdAt", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "malformed-v2-memo", now: "2026-05-12T09:00:00.000Z" });
    driver.seed("users/user-1/backupSnapshots/malformed-v2", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "not-a-date",
      memoCount: 1,
      state: "complete",
      savedAt: new FakeTimestamp("2026-05-12T09:01:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/malformed-v2/memos/malformed-v2-memo", {
      userId: "user-1",
      memoId: memo.id,
      memo,
    });

    await expect(loadBackupSnapshot(gateway, "user-1", "malformed-v2")).resolves.toBeNull();
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

    await expect(loadBackupSnapshot(gateway, "user-1", "missing")).resolves.toBeNull();
    await expect(loadBackupSnapshot(gateway, "user-1", "extra")).resolves.toBeNull();
    await expect(loadBackupSnapshot(gateway, "user-1", "malformed")).resolves.toBeNull();
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
