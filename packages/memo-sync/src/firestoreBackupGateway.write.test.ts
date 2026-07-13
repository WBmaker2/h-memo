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

describe("FirestoreBackupGateway driver contract", () => {
  function createGateway(driver: FakeFirestoreDriver) {
    return new FirestoreBackupGateway({} as never, driver as never);
  }

  function snapshotId(path: string | { snapshotId: string }) {
    return typeof path === "string" ? path.split("/").at(-1)! : path.snapshotId;
  }

  function payloadAt(createdAt: string): MemoBackupPayload {
    return {
      version: 1,
      userId: "user-1",
      createdAt,
      memos: [createMemo({ id: "memo-daily", now: "2026-07-13T00:00:00.000Z" })],
    };
  }

  function payloadWithText(plainText: string): MemoBackupPayload {
    return {
      ...payloadAt("2026-07-13T01:00:00.000Z"),
      memos: [
        createMemo({
          id: "memo-daily",
          now: "2026-07-13T00:00:00.000Z",
          plainText,
        }),
      ],
    };
  }

  it("skips every remote write for identical content on the same KST date", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.setServerClock("2026-07-13T01:00:00.000Z");

    const first = await gateway.saveBackup("user-1", payloadAt("2026-07-13T01:00:00.000Z"));
    driver.seed("users/user-1/backupSnapshots/duplicate", {
      schemaVersion: 3,
      state: "complete",
      userId: "user-1",
      memoCount: 0,
      contentHash: "b".repeat(64),
      previewText: "duplicate",
      clientCreatedAt: "2026-07-13T00:00:00.000Z",
      savedAt: new FakeTimestamp("2026-07-13T00:00:00.000Z"),
    });
    const commits = driver.transactionCommitCount;
    const second = await gateway.saveBackup("user-1", payloadAt("2026-07-13T10:00:00.000Z"));

    expect(second.outcome).toBe("unchanged");
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(driver.transactionCommitCount).toBe(commits);
    expect(driver.hasPath("users/user-1/backupSnapshots/duplicate")).toBe(true);
    expect(driver.batchOperationCounts).toEqual([]);
  });

  it("keeps a successful activated backup when cleanup commit fails", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.setServerClock("2026-07-13T01:00:00.000Z");
    await gateway.saveBackup("user-1", payloadWithText("첫 내용"));
    driver.seed("users/user-1/backupSnapshots/duplicate", {
      schemaVersion: 3,
      state: "complete",
      userId: "user-1",
      memoCount: 0,
      contentHash: "b".repeat(64),
      previewText: "duplicate",
      clientCreatedAt: "2026-07-13T00:00:00.000Z",
      savedAt: new FakeTimestamp("2026-07-13T00:00:00.000Z"),
    });
    driver.failBatchCommit = 1;

    const result = await gateway.saveBackup("user-1", payloadWithText("바뀐 내용"));

    expect(result.outcome).toBe("replaced");
    expect(result.cleanupPending).toBe(true);
    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: result.snapshotId,
      pendingSnapshotId: null,
    });
  });

  it("writes a new v3 snapshot when the same-day content changes", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.setServerClock("2026-07-13T01:00:00.000Z");

    const first = await gateway.saveBackup("user-1", payloadWithText("첫 내용"));
    const second = await gateway.saveBackup("user-1", payloadWithText("바뀐 내용"));

    expect(second.outcome).toBe("replaced");
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(driver.read(`users/user-1/backupSnapshots/${second.snapshotId}`)).toMatchObject({
      schemaVersion: 3,
      state: "complete",
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("writes the same content again on the next KST date", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.setServerClock("2026-07-12T14:59:00.000Z");
    const first = await gateway.saveBackup("user-1", payloadAt("2026-07-12T14:59:00.000Z"));

    driver.setServerClock("2026-07-12T15:01:00.000Z");
    const second = await gateway.saveBackup("user-1", payloadAt("2026-07-12T15:01:00.000Z"));

    expect(second.outcome).toBe("created");
    expect(second.snapshotId).not.toBe(first.snapshotId);
  });

  it("writes more than 200 memos in bounded transactions and activates only after the snapshot is complete", async () => {
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

    expect(driver.transactionOperationCounts).toEqual([2, 400, 2, 2]);
    expect(driver.transactionOperationCounts.every((count) => count <= 400)).toBe(true);
    expect(driver.read(`users/user-1/backupSnapshots/${id}`)).toMatchObject({
      schemaVersion: 3,
      state: "complete",
      memoCount: 201,
    });
    expect(driver.read("users/user-1/backupState/current")).toMatchObject({
      activeSnapshotId: id,
    });
    expect(driver.read("users/user-1/memosV2/memo-0")).toMatchObject({
      userId: "user-1",
      memoId: "memo-0",
      active: null,
      pending: {
        snapshotId: id,
        savedAt: expect.any(FakeTimestamp),
      },
    });
    expect(driver.read("users/user-1/memosV2/memo-0")).not.toHaveProperty("generations");
    expect(driver.read("users/user-1/memosV2/memo-0")).not.toHaveProperty("memo");
    const currentMemos = await gateway.loadCurrentMemos("user-1");
    expect(currentMemos.map((entry) => entry.memo.id)).toHaveLength(201);
    expect(currentMemos[0]).toMatchObject({ snapshotId: id });
    expect(currentMemos[0]?.savedAt).toMatch(/2026-05-13T09:00:/);
  });

  it("rejects an invalid new v2 payload before any remote mutation", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-invalid-write", now: "2026-05-13T09:00:00.000Z" });

    await expect(
      gateway.saveBackup("user-1", {
        version: 1,
        userId: "user-1",
        createdAt: "not-a-timestamp",
        memos: [{ ...memo, updatedAt: "" }],
      })
    ).rejects.toThrow("잘못된 메모 데이터가 포함되어 있습니다.");

    expect(driver.docs).toEqual(new Map());
    expect(driver.transactionOperationCounts).toEqual([]);
  });

  it("returns zero and does not write a tombstone for an absent canonical memo", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "snapshot-active",
      pendingSnapshotId: null,
      activatedAt: new FakeTimestamp("2026-05-13T09:00:00.000Z"),
    });

    expect(await gateway.deleteCurrentMemo("user-1", "missing/memo")).toBe(0);
    expect(
      driver.read(
        `users/user-1/serverMemoDeletesV2/${encodeMemoDocumentId("missing/memo")}`
      )
    ).toBeUndefined();
  });

  it("uses one collision-resistant memo document codec for backup, restore, and delete paths", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memoIds = ["a/b", "a?b", "a#b", "유니코드", "memo~legacy", ".", ".."];
    const memos = memoIds.map((id) => createMemo({ id, now: "2026-05-13T09:00:00.000Z" }));

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos,
    });

    for (const memoId of memoIds) {
      const documentId = encodeMemoDocumentId(memoId);
      expect(driver.read(`users/user-1/memosV2/${documentId}`)).toMatchObject({ memoId });
      expect(
        driver.read(`users/user-1/backupSnapshots/1/memosV3/${documentId}`)
      ).toMatchObject({ memoId, memo: { id: memoId } });
    }
    expect((await listBackedUpMemos(gateway, "user-1")).map(({ memo }) => memo.id).sort()).toEqual(
      [...memoIds].sort()
    );
    expect((await restoreLatestBackup(gateway, "user-1"))?.memos.map((memo) => memo.id).sort()).toEqual(
      [...memoIds].sort()
    );

    expect(await deleteBackedUpMemo(gateway, "user-1", "a/b")).toBe(1);
    expect(driver.read(`users/user-1/serverMemoDeletesV2/${encodeMemoDocumentId("a/b")}`)).toMatchObject({
      memoId: "a/b",
    });
    expect((await listBackedUpMemos(gateway, "user-1")).map(({ memo }) => memo.id)).not.toContain("a/b");
    expect((await listBackedUpMemos(gateway, "user-1")).map(({ memo }) => memo.id)).toContain("a#b");
  });

  it("supersedes a v2 tombstone when a same-ID backup activates and restores the memo", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo-rebackup", now: "2026-05-13T09:00:00.000Z" });
    const tombstonePath = `users/user-1/serverMemoDeletesV2/${encodeMemoDocumentId(memo.id)}`;

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:01:00.000Z",
      memos: [memo],
    });
    await gateway.deleteCurrentMemo("user-1", memo.id);
    expect(driver.read(tombstonePath)).toMatchObject({ memoId: memo.id });

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:03:00.000Z",
      memos: [{ ...memo, plainText: "backed up again" }],
    });

    expect(driver.read(tombstonePath)).toMatchObject({
      memoId: memo.id,
      snapshotId: "1",
    });
    expect(await gateway.loadDeletedMemoIds("user-1")).toEqual([]);
    expect((await restoreLatestBackup(gateway, "user-1"))?.memos.map((item) => item.id)).toEqual([
      memo.id,
    ]);
  });

  it("re-backs up 500-plus memos with tombstones in bounded transactions", async () => {
    const driver = new FakeFirestoreDriver();
    driver.maxTransactionReads = 1000;
    const gateway = createGateway(driver);
    const memos = Array.from({ length: 501 }, (_, index) =>
      createMemo({ id: `memo-bounded-${index}`, now: "2026-05-13T09:00:00.000Z" })
    );

    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos,
    });
    for (const memo of memos) {
      expect(await gateway.deleteCurrentMemo("user-1", memo.id)).toBe(1);
    }

    const rebackedMemos = memos.map((memo) => ({ ...memo, plainText: `rebacked ${memo.id}` }));
    await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: rebackedMemos,
    });

    expect(Math.max(...driver.transactionReadCounts)).toBe(401);
    expect(Math.max(...driver.transactionWriteCounts)).toBe(400);
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toHaveLength(501);
    expect((await restoreLatestBackup(gateway, "user-1"))?.memos.map((memo) => memo.id).sort()).toEqual(
      rebackedMemos.map((memo) => memo.id).sort()
    );
    expect((await listBackedUpMemos(gateway, "user-1")).map((entry) => entry.memo.id)).toHaveLength(501);
    expect(driver.read("users/user-1/serverMemoDeletesV2/memo-bounded-0")).toMatchObject({
      memoId: "memo-bounded-0",
      snapshotId: "1",
    });
  });

  it("isolates a new encoded memo from a reserved-prefix legacy raw document", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const legacyPath = "users/user-1/memos/memo~003f";
    const legacyDocument = {
      userId: "user-1",
      memoId: "memo~003f",
      active: {
        snapshotId: "legacy-active",
        savedAt: new FakeTimestamp("2026-05-13T08:59:00.000Z"),
      },
      pending: null,
    };
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "legacy-active",
      pendingSnapshotId: null,
      activatedAt: new FakeTimestamp("2026-05-13T08:59:00.000Z"),
    });
    driver.seed(legacyPath, legacyDocument);

    const path = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: [createMemo({ id: "?", now: "2026-05-13T09:00:00.000Z" })],
    });
    const id = snapshotId(path);

    expect(driver.read(legacyPath)).toEqual(legacyDocument);
    expect(driver.read("users/user-1/memos/memo~003f")).toEqual(legacyDocument);
    expect(driver.read("users/user-1/memosV2/memo~003f")).toMatchObject({
      userId: "user-1",
      memoId: "?",
    });
    expect(
      driver.read(`users/user-1/backupSnapshots/${id}/memosV3/memo~003f`)
    ).toMatchObject({ memoId: "?", memo: { id: "?" } });
    expect(driver.read(`users/user-1/backupSnapshots/${id}/memos/memo~003f`)).toBeUndefined();
  });

  it("reads a reserved-prefix legacy raw canonical and snapshot memo without decoding it as '?'", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "memo~003f", now: "2026-05-13T09:00:00.000Z" });
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "legacy-active",
      pendingSnapshotId: null,
      activatedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/legacy-active", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memoCount: 1,
      state: "complete",
      savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/legacy-active/memos/memo~003f", {
      userId: "user-1",
      memoId: memo.id,
      memo,
    });
    driver.seed("users/user-1/memos/memo~003f", {
      userId: "user-1",
      memoId: memo.id,
      active: {
        snapshotId: "legacy-active",
        savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
      },
      pending: null,
    });

    expect(await gateway.loadCurrentMemos("user-1")).toEqual([
      expect.objectContaining({ memo, snapshotId: "legacy-active" }),
    ]);
  });

  it("ignores a legacy document when its stored memo ID only matches the encoded interpretation", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "?", now: "2026-05-13T09:00:00.000Z" });
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "legacy-active",
      pendingSnapshotId: null,
      activatedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/legacy-active", {
      schemaVersion: 2,
      userId: "user-1",
      createdAt: "2026-05-13T09:00:00.000Z",
      memoCount: 1,
      state: "complete",
      savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
    });
    driver.seed("users/user-1/backupSnapshots/legacy-active/memos/memo~003f", {
      userId: "user-1",
      memoId: memo.id,
      memo,
    });
    driver.seed("users/user-1/memos/memo~003f", {
      userId: "user-1",
      memoId: memo.id,
      active: {
        snapshotId: "legacy-active",
        savedAt: new FakeTimestamp("2026-05-13T09:01:00.000Z"),
      },
      pending: null,
    });

    expect(await gateway.loadCurrentMemos("user-1")).toEqual([]);
  });

  it("migrates an existing raw legacy canonical document to the encoded path", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = createGateway(driver);
    const memo = createMemo({ id: "a?b", now: "2026-05-13T09:00:00.000Z" });
    const legacyRef = "users/user-1/memos/a?b";
    const encodedRef = `users/user-1/memosV2/${encodeMemoDocumentId(memo.id)}`;
    driver.seed("users/user-1/backupState/current", {
      userId: "user-1",
      activeSnapshotId: "legacy-active",
      pendingSnapshotId: null,
      activatedAt: new FakeTimestamp("2026-05-13T08:59:00.000Z"),
    });
    driver.seed(legacyRef, {
      userId: "user-1",
      memoId: memo.id,
      active: {
        snapshotId: "legacy-active",
        savedAt: new FakeTimestamp("2026-05-13T08:59:00.000Z"),
      },
      pending: null,
    });

    const path = await gateway.saveBackup("user-1", {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: [memo],
    });

    expect(driver.read(encodedRef)).toMatchObject({ memoId: memo.id });
    expect(driver.read(legacyRef)).toMatchObject({ memoId: memo.id, pending: null });
    expect(driver.read(encodedRef)?.pending).toMatchObject({ snapshotId: snapshotId(path) });
    expect(driver.read(legacyRef)?.pending).toBeNull();
    expect((await gateway.loadCurrentMemos("user-1")).map((entry) => entry.memo.id)).toEqual([
      memo.id,
    ]);

    expect(await gateway.deleteCurrentMemo("user-1", memo.id)).toBe(1);
    expect(driver.read(encodedRef)).toMatchObject({ pending: null });
    expect(driver.read(legacyRef)).toMatchObject({ pending: null });
    expect(await gateway.loadCurrentMemos("user-1")).toEqual([]);
  });

});
