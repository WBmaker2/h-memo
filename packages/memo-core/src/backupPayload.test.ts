import { describe, expect, it } from "vitest";
import { createMemo } from "./memoFactory";
import {
  createBackupPayload,
  validateBackupPayload,
  validateLocalBackupPayload,
} from "./backupPayload";

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

    expect(validateBackupPayload(payload, "user-2")).toEqual({
      ok: false,
      reason: "다른 사용자의 백업 데이터입니다.",
    });
  });

  it("accepts local JSON backups without checking the current user id", () => {
    const payload = createBackupPayload({
      userId: "someone-else",
      memos: [createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" })],
      createdAt: "2026-05-13T09:05:00.000Z",
    });

    expect(validateLocalBackupPayload(payload)).toEqual({
      ok: true,
      payload,
    });
  });

  it("rejects payloads with memo missing id", () => {
    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: [{ title: "제목 없음" }],
    };

    expect(validateBackupPayload(payload, "user-1")).toEqual({
      ok: false,
      reason: "잘못된 메모 데이터가 포함되어 있습니다.",
    });
  });

  it("rejects payloads with malformed memo fields", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: [
        {
          ...(memo as unknown as Record<string, unknown>),
          syncState: "unsupported",
        },
      ],
    };

    expect(validateBackupPayload(payload, "user-1")).toEqual({
      ok: false,
      reason: "잘못된 메모 데이터가 포함되어 있습니다.",
    });
  });

  it("rejects payloads with invalid nested shape (style/windowState)", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: [
        {
          ...memo,
          style: { ...memo.style, fontSize: "16" },
          windowState: {
            ...memo.windowState,
            width: "320",
          },
        },
      ],
    };

    expect(validateBackupPayload(payload, "user-1")).toEqual({
      ok: false,
      reason: "잘못된 메모 데이터가 포함되어 있습니다.",
    });
  });

  it("rejects payloads with missing richContent", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const brokenMemo = { ...memo } as Record<string, unknown>;
    delete brokenMemo.richContent;

    const payload = {
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T09:05:00.000Z",
      memos: [brokenMemo],
    };

    expect(validateBackupPayload(payload, "user-1")).toEqual({
      ok: false,
      reason: "잘못된 메모 데이터가 포함되어 있습니다.",
    });
  });
});
