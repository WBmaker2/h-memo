import { describe, expect, it } from "vitest";
import {
  createMemo,
  renameMemo,
  softDeleteMemo,
  updateMemoStyle,
} from "./memoFactory";

describe("memoFactory", () => {
  it("creates a safe default memo", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });

    expect(memo.id).toBe("memo-1");
    expect(memo.title).toBe("새 메모");
    expect(memo.plainText).toBe("");
    expect(memo.style.backgroundColor).toBe("#fff7b8");
    expect(memo.windowState.visible).toBe(true);
    expect(memo.syncState).toBe("local-only");
  });

  it("renames and marks the memo as queued", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const updated = renameMemo(memo, "회의 메모", "2026-05-13T09:01:00.000Z");

    expect(updated.title).toBe("회의 메모");
    expect(updated.updatedAt).toBe("2026-05-13T09:01:00.000Z");
    expect(updated.syncState).toBe("queued");
  });

  it("updates style without mutating the original memo", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const updated = updateMemoStyle(
      memo,
      { textColor: "#111111", fontSize: 20 },
      "2026-05-13T09:02:00.000Z"
    );

    expect(memo.style.textColor).toBe("#1f2937");
    expect(updated.style.textColor).toBe("#111111");
    expect(updated.style.fontSize).toBe(20);
  });

  it("soft deletes memo instead of removing it", () => {
    const memo = createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" });
    const deleted = softDeleteMemo(memo, "2026-05-13T09:03:00.000Z");

    expect(deleted.deletedAt).toBe("2026-05-13T09:03:00.000Z");
    expect(deleted.windowState.visible).toBe(false);
  });
});
