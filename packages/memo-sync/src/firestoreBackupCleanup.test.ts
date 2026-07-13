import { describe, expect, it } from "vitest";
import { cleanupFirestoreBackups } from "./firestoreBackupCleanup";
import { FakeFirestoreDriver, FakeTimestamp } from "./testing/fakeFirestoreBackupDriver";

const userId = "user-1";
const now = "2026-07-13T12:00:00.000Z";
const context = (driver: FakeFirestoreDriver) => ({
  firestore: {} as never,
  driver,
});

function seedSummary(
  driver: FakeFirestoreDriver,
  id: string,
  savedAt: string,
  schemaVersion: 1 | 2 | 3 = 2
) {
  const metadata = schemaVersion === 3
    ? {
        schemaVersion: 3,
        state: "complete",
        userId,
        memoCount: 0,
        contentHash: "a".repeat(64),
        previewText: "",
        clientCreatedAt: savedAt,
        savedAt: new FakeTimestamp(savedAt),
      }
    : schemaVersion === 2
      ? {
          schemaVersion: 2,
          state: "complete",
          userId,
          memoCount: 0,
          createdAt: savedAt,
          savedAt: new FakeTimestamp(savedAt),
        }
      : {
          version: 1,
          userId,
          createdAt: savedAt,
          memos: [],
          savedAt: new FakeTimestamp(savedAt),
        };
  driver.seed(`users/${userId}/backupSnapshots/${id}`, metadata);
}

function seedChild(
  driver: FakeFirestoreDriver,
  snapshotId: string,
  collection: "memosV3" | "memosV2" | "memos",
  id: string
) {
  driver.seed(
    `users/${userId}/backupSnapshots/${snapshotId}/${collection}/${id}`,
    { userId, memoId: id }
  );
}

describe("firestore backup cleanup", () => {
  it("uses supplied protection IDs when the state document does not exist yet", async () => {
    const driver = new FakeFirestoreDriver();
    seedSummary(driver, "active", "2025-01-01T00:00:00.000Z");
    seedSummary(driver, "pending", "2025-01-02T00:00:00.000Z");
    seedSummary(driver, "expired", "2025-01-03T00:00:00.000Z");

    const result = await cleanupFirestoreBackups(context(driver), userId, {
      now,
      activeSnapshotId: "active",
      pendingSnapshotId: "pending",
    });

    expect(driver.hasPath("users/user-1/backupSnapshots/active")).toBe(true);
    expect(driver.hasPath("users/user-1/backupSnapshots/pending")).toBe(true);
    expect(driver.hasPath("users/user-1/backupSnapshots/expired")).toBe(false);
    expect(result.deletedDocuments).toBe(1);
  });

  it("never schedules actual active or pending snapshots when options are stale", async () => {
    const driver = new FakeFirestoreDriver();
    seedSummary(driver, "actual-active", "2025-01-01T00:00:00.000Z");
    seedSummary(driver, "actual-pending", "2025-01-02T00:00:00.000Z");
    seedSummary(driver, "expired", "2025-01-03T00:00:00.000Z");
    driver.seed("users/user-1/backupState/current", {
      userId,
      activeSnapshotId: "actual-active",
      pendingSnapshotId: "actual-pending",
    });

    const result = await cleanupFirestoreBackups(context(driver), userId, {
      now,
      activeSnapshotId: "stale-active",
      pendingSnapshotId: "stale-pending",
    });

    expect(driver.hasPath("users/user-1/backupSnapshots/actual-active")).toBe(true);
    expect(driver.hasPath("users/user-1/backupSnapshots/actual-pending")).toBe(true);
    expect(driver.hasPath("users/user-1/backupSnapshots/expired")).toBe(false);
    expect(result.deletedDocuments).toBeGreaterThan(0);
  });

  it("deletes v3, v2, and legacy child documents before parent metadata", async () => {
    const driver = new FakeFirestoreDriver();
    seedSummary(driver, "kept", "2026-07-13T12:00:00.000Z", 3);
    seedSummary(driver, "duplicate", "2026-07-13T11:00:00.000Z", 3);
    seedChild(driver, "duplicate", "memosV3", "memo~0061");
    seedChild(driver, "duplicate", "memosV2", "memo~0062");
    seedChild(driver, "duplicate", "memos", "memo~0063");

    await cleanupFirestoreBackups(context(driver), userId, {
      now,
      activeSnapshotId: null,
      pendingSnapshotId: null,
    });

    const parent = "users/user-1/backupSnapshots/duplicate";
    for (const child of ["memosV3/memo~0061", "memosV2/memo~0062", "memos/memo~0063"]) {
      expect(driver.committedDeletePaths.indexOf(`${parent}/${child}`)).toBeGreaterThanOrEqual(0);
      expect(driver.committedDeletePaths.indexOf(`${parent}/${child}`)).toBeLessThan(
        driver.committedDeletePaths.indexOf(parent)
      );
    }
    expect(driver.hasPath(parent)).toBe(false);
  });

  it("stops at 400 deletes and resumes partial child deletion later", async () => {
    const driver = new FakeFirestoreDriver();
    seedSummary(driver, "expired", "2025-01-01T00:00:00.000Z", 3);
    for (let index = 0; index < 450; index += 1) {
      seedChild(driver, "expired", "memosV3", `memo-${String(index).padStart(3, "0")}`);
    }

    const first = await cleanupFirestoreBackups(context(driver), userId, {
      now,
      activeSnapshotId: null,
      pendingSnapshotId: null,
    });
    expect(first.deletedDocuments).toBe(400);
    expect(first.pending).toBe(true);
    expect(driver.hasPath("users/user-1/backupSnapshots/expired")).toBe(true);

    const second = await cleanupFirestoreBackups(context(driver), userId, {
      now,
      activeSnapshotId: null,
      pendingSnapshotId: null,
    });
    expect(second.deletedDocuments).toBe(51);
    expect(second.pending).toBe(false);
    expect(driver.hasPath("users/user-1/backupSnapshots/expired")).toBe(false);
  });
});
