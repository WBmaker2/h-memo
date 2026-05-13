import { describe, expect, it } from "vitest";
import { createMemo } from "./memoFactory";
import { createBackupPayload, validateBackupPayload } from "./backupPayload";

describe("backupPayload", () => {
  it("creates a versioned backup payload", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const payload = createBackupPayload({
      userId: "user-1",
      memos: [memo],
      createdAt: "2026-05-13T09:05:00.000Z",
    });

    expect(payload.version).toBe(1);
    expect(payload.userId).toBe("user-1");
    expect(payload.memos).toHaveLength(1);
  });

  it("rejects payloads for the wrong user", () => {
    const payload = createBackupPayload({
      userId: "user-1",
      memos: [createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" })],
      createdAt: "2026-05-13T09:05:00.000Z",
    });

    expect(validateBackupPayload(payload, "user-2").ok).toBe(false);
  });
});
