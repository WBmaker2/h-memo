import { describe, expect, it, vi } from "vitest";
import type { MemoBackupPayload, BackupGateway, BackupSnapshotSummary } from "@h-memo/memo-sync";
import {
  loadDesktopBackupSelection,
  restoreDesktopBackupSelection,
} from "./desktopBackupHistory";

const summary: BackupSnapshotSummary = {
  id: "selected-snapshot",
  savedAt: "2026-07-12T15:00:00.000Z",
  kstDate: "2026-07-13",
  memoCount: 2,
  previewText: "첫 메모, 두 번째 메모",
  contentHash: null,
  schemaVersion: 1,
  state: "complete",
  legacyUndated: false,
};

const payload = {
  version: 1,
  userId: "user-1",
  createdAt: summary.savedAt!,
  memos: [],
} satisfies MemoBackupPayload;

describe("desktop backup history workflow", () => {
  it("confirms before loading the selected snapshot ID", async () => {
    const confirm = vi.fn(() => true);
    const loadSnapshot = vi.fn(async () => payload);

    const result = await loadDesktopBackupSelection({
      gateway: {} as BackupGateway,
      userId: "user-1",
      snapshotId: summary.id,
      summaries: [summary],
      confirm,
      loadSnapshot,
    });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("2026. 7. 13. 오전 12:00:00"));
    expect(loadSnapshot).toHaveBeenCalledWith(expect.anything(), "user-1", summary.id);
    expect(result).toEqual({ kind: "ready", summary, payload });
  });

  it("does not load or return a restore payload after cancellation", async () => {
    const loadSnapshot = vi.fn(async () => payload);

    const result = await loadDesktopBackupSelection({
      gateway: {} as BackupGateway,
      userId: "user-1",
      snapshotId: summary.id,
      summaries: [summary],
      confirm: () => false,
      loadSnapshot,
    });

    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "cancelled", summary });
  });

  it("returns unavailable without exposing a null payload to the restore caller", async () => {
    const restore = vi.fn(async () => {});
    const result = await loadDesktopBackupSelection({
      gateway: {} as BackupGateway,
      userId: "user-1",
      snapshotId: summary.id,
      summaries: [summary],
      confirm: () => true,
      loadSnapshot: async () => null,
    });

    expect(result).toEqual({ kind: "unavailable", summary });

    await restoreDesktopBackupSelection({
      gateway: {} as BackupGateway,
      userId: "user-1",
      snapshotId: summary.id,
      summaries: [summary],
      confirm: () => true,
      loadSnapshot: async () => null,
      restore,
    });
    expect(restore).not.toHaveBeenCalled();
  });
});
