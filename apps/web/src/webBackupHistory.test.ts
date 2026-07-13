import { describe, expect, it, vi } from "vitest";
import type {
  BackupGateway,
  BackupSnapshotSummary,
  MemoBackupPayload,
} from "@h-memo/memo-sync";
import {
  loadWebBackupSelection,
  restoreWebBackupSelection,
} from "./webBackupHistory";

const summary: BackupSnapshotSummary = {
  id: "selected-snapshot",
  savedAt: "2026-07-12T15:00:00.000Z",
  kstDate: "2026-07-13",
  memoCount: 0,
  previewText: "메모 없음",
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

describe("web backup history workflow", () => {
  it("confirms before loading exactly the selected snapshot ID", async () => {
    const confirm = vi.fn(() => true);
    const loadSnapshot = vi.fn(async () => payload);

    const result = await loadWebBackupSelection({
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

  it("does not load or restore after cancellation", async () => {
    const loadSnapshot = vi.fn(async () => payload);
    const restore = vi.fn(async () => {});

    const result = await restoreWebBackupSelection({
      gateway: {} as BackupGateway,
      userId: "user-1",
      snapshotId: summary.id,
      summaries: [summary],
      confirm: () => false,
      loadSnapshot,
      restore,
    });

    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "cancelled", summary });
  });

  it("does not expose null or invalid payloads to the restore caller", async () => {
    const restore = vi.fn(async () => {});

    await expect(
      loadWebBackupSelection({
        gateway: {} as BackupGateway,
        userId: "user-1",
        snapshotId: summary.id,
        summaries: [summary],
        confirm: () => true,
        loadSnapshot: async () => null,
      })
    ).resolves.toEqual({ kind: "unavailable", summary });

    await expect(
      restoreWebBackupSelection({
        gateway: {} as BackupGateway,
        userId: "user-1",
        snapshotId: summary.id,
        summaries: [summary],
        confirm: () => true,
        loadSnapshot: async () => ({ ...payload, userId: "other-user" }),
        restore,
      })
    ).resolves.toEqual({ kind: "unavailable", summary });

    expect(restore).not.toHaveBeenCalled();
  });
});
