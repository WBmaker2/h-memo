import { describe, expect, it } from "vitest";
import { createMemo } from "@h-memo/memo-core";
import {
  WEB_AUTO_BACKUP_IDLE_MS,
  createWebMemoFingerprint,
  hasWebBackupConflict,
} from "./webAutoBackup";

describe("webAutoBackup", () => {
  it("uses a ten-second idle window", () => {
    expect(WEB_AUTO_BACKUP_IDLE_MS).toBe(10_000);
  });

  it("creates the same fingerprint regardless of memo order", () => {
    const first = createMemo({ id: "memo-a", now: "2026-07-24T10:00:00.000Z", title: "A" });
    const second = createMemo({ id: "memo-b", now: "2026-07-24T10:00:01.000Z", title: "B" });

    expect(createWebMemoFingerprint([first, second])).toBe(
      createWebMemoFingerprint([second, first])
    );
  });

  it("detects a server snapshot change", () => {
    expect(hasWebBackupConflict("snapshot-1", "snapshot-2")).toBe(true);
    expect(hasWebBackupConflict("snapshot-1", "snapshot-1")).toBe(false);
    expect(hasWebBackupConflict(null, null)).toBe(false);
  });
});
