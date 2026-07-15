import { describe, expect, it } from "vitest";

import { listBackupSnapshotSummaryPage } from "./backup";
import { FirestoreBackupGateway } from "./firestoreBackupGateway";
import {
  FakeFirestoreDriver,
  FakeTimestamp,
} from "./testing/fakeFirestoreBackupDriver";

function seedSnapshots(driver: FakeFirestoreDriver, count: number) {
  for (let index = 0; index < count; index += 1) {
    const savedAt = new Date(Date.UTC(2026, 6, 15 - index, 0, 0, 0)).toISOString();
    const id = `snapshot-${String(index + 1).padStart(2, "0")}`;
    driver.seed(`users/user-1/backupSnapshots/${id}`, {
      schemaVersion: 3,
      userId: "user-1",
      clientCreatedAt: savedAt,
      memoCount: 1,
      contentHash: String(index).padStart(64, "0"),
      previewText: `백업 ${index + 1}`,
      state: "complete",
      savedAt: new FakeTimestamp(savedAt),
    });
  }
}

describe("Firestore backup history cursor pagination", () => {
  it("reads at most page size plus one and continues without duplicates", async () => {
    const driver = new FakeFirestoreDriver();
    const gateway = new FirestoreBackupGateway({} as never, driver as never);
    seedSnapshots(driver, 25);
    const now = "2026-07-15T12:00:00.000Z";

    const first = await listBackupSnapshotSummaryPage(gateway, "user-1", {
      limit: 10,
      now,
    });
    const second = await listBackupSnapshotSummaryPage(gateway, "user-1", {
      limit: 10,
      cursor: first.nextCursor,
      now,
    });
    const third = await listBackupSnapshotSummaryPage(gateway, "user-1", {
      limit: 10,
      cursor: second.nextCursor,
      now,
    });

    expect(first.summaries).toHaveLength(10);
    expect(second.summaries).toHaveLength(10);
    expect(third.summaries).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    expect(second.nextCursor).not.toBeNull();
    expect(third.nextCursor).toBeNull();
    expect(driver.pageReadDocumentCounts).toEqual([11, 11, 5]);

    const ids = [...first.summaries, ...second.summaries, ...third.summaries].map(
      (summary) => summary.id,
    );
    expect(ids).toEqual(
      Array.from({ length: 25 }, (_, index) =>
        `snapshot-${String(index + 1).padStart(2, "0")}`,
      ),
    );
    expect(new Set(ids).size).toBe(25);
  });

  it("falls back to offset pages for gateways without cursor support", async () => {
    const summaries = Array.from({ length: 12 }, (_, index) => ({
      id: `legacy-${index + 1}`,
      savedAt: new Date(Date.UTC(2026, 6, 15 - index)).toISOString(),
      kstDate: new Date(Date.UTC(2026, 6, 15 - index)).toISOString().slice(0, 10),
      memoCount: 1,
      previewText: `레거시 ${index + 1}`,
      contentHash: null,
      schemaVersion: 1 as const,
      state: "complete" as const,
      legacyUndated: false,
    }));
    const gateway = {
      async listBackupSummaries() {
        return summaries;
      },
    } as never;

    const first = await listBackupSnapshotSummaryPage(gateway, "user-1", {
      limit: 10,
      now: "2026-07-15T12:00:00.000Z",
    });
    const second = await listBackupSnapshotSummaryPage(gateway, "user-1", {
      limit: 10,
      cursor: first.nextCursor,
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(first.summaries).toHaveLength(10);
    expect(first.nextCursor).toEqual({ kind: "offset", offset: 10 });
    expect(second.summaries.map((summary) => summary.id)).toEqual([
      "legacy-11",
      "legacy-12",
    ]);
    expect(second.nextCursor).toBeNull();
  });
});
