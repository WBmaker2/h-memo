import { describe, expect, it } from "vitest";
import type { BackupSnapshotSummary } from "./backupSnapshotSummary";
import {
  planBackupCleanupCandidates,
  selectDailyBackupSummaries,
} from "./backupRetention";

function summary(id: string, savedAt: string | null, overrides: Partial<BackupSnapshotSummary> = {}) {
  return {
    id,
    savedAt,
    kstDate: savedAt ? savedAt.slice(0, 10) : null,
    memoCount: 1,
    previewText: "",
    contentHash: null,
    schemaVersion: 2 as const,
    state: "complete" as const,
    legacyUndated: savedAt === null,
    ...overrides,
  } satisfies BackupSnapshotSummary;
}

describe("backup retention planning", () => {
  it("returns only the latest complete snapshot for each KST date", () => {
    const result = selectDailyBackupSummaries(
      [
        summary("old", "2026-07-13T01:00:00.000Z"),
        summary("latest", "2026-07-13T12:00:00.000Z"),
        summary("previous", "2026-07-12T12:00:00.000Z"),
      ],
      "2026-07-13T12:30:00.000Z"
    );
    expect(result.map((item) => item.id)).toEqual(["latest", "previous"]);
  });

  it("keeps undated legacy backups visible but never schedules them automatically", () => {
    const undated = summary("legacy", null, { legacyUndated: true });
    expect(selectDailyBackupSummaries([undated], "2026-07-13T12:30:00.000Z")).toEqual([undated]);
    expect(
      planBackupCleanupCandidates([undated], {
        activeSnapshotId: null,
        pendingSnapshotId: null,
        now: "2026-07-13T12:30:00.000Z",
      })
    ).toEqual([]);
  });

  it("protects undated v2-compatible summaries from cleanup", () => {
    const undatedV2 = summary("v2-undated", null, {
      schemaVersion: 2,
      legacyUndated: true,
    });

    expect(
      planBackupCleanupCandidates([undatedV2], {
        activeSnapshotId: null,
        pendingSnapshotId: null,
        now: "2026-07-13T12:30:00.000Z",
      })
    ).toEqual([]);
  });

  it("prioritizes duplicates before expired snapshots and protects active and pending IDs", () => {
    const candidates = planBackupCleanupCandidates(
      [
        summary("active", "2026-07-13T01:00:00.000Z"),
        summary("pending", "2026-07-12T01:00:00.000Z"),
        summary("kept", "2026-07-12T12:00:00.000Z"),
        summary("duplicate", "2026-07-12T01:00:00.000Z"),
        summary("expired", "2025-07-13T12:00:00.000Z"),
      ],
      {
        activeSnapshotId: "active",
        pendingSnapshotId: "pending",
        now: "2026-07-13T12:30:00.000Z",
      }
    );
    expect(candidates.map((item) => item.id)).toEqual(["duplicate", "expired"]);
    expect(candidates.map((item) => item.reason)).toEqual([
      "same-day-duplicate",
      "expired",
    ]);
  });

  it("does not delete future or invalid dates and expires only valid dates before retention start", () => {
    const summaries = [
      summary("retention-start", "2025-07-14T00:00:00.000Z"),
      summary("expired", "2025-07-13T23:59:59.999Z"),
      summary("future", "2026-07-13T15:00:00.000Z", { kstDate: "2026-07-14" }),
      summary("invalid", null, { kstDate: "2026-02-31", legacyUndated: false }),
    ];
    expect(
      planBackupCleanupCandidates(summaries, {
        activeSnapshotId: null,
        pendingSnapshotId: null,
        now: "2026-07-13T12:30:00.000Z",
      })
    ).toEqual([
      expect.objectContaining({ id: "expired", reason: "expired", kstDate: "2025-07-13" }),
    ]);
  });

  it("sorts non-ASCII IDs independently of the host locale", () => {
    const result = selectDailyBackupSummaries(
      [
        summary("ä", "2026-07-12T10:00:00.000Z"),
        summary("a", "2026-07-11T10:00:00.000Z"),
        summary("b", "2026-07-10T10:00:00.000Z"),
      ],
      "2026-07-13T12:30:00.000Z"
    );
    expect(result.map((item) => item.id)).toEqual(["ä", "a", "b"]);
  });
});
