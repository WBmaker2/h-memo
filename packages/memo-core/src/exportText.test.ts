import { describe, expect, it } from "vitest";
import { createMemo } from "./memoFactory";
import { formatMemoAsText, formatMemosAsCombinedText } from "./exportText";

describe("text export", () => {
  it("formats one memo as text", () => {
    const memo = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      title: "수업 준비",
      updatedAt: "2026-05-13T09:10:00.000Z",
      plainText: "준비물 확인",
    };

    const text = formatMemoAsText(memo);

    expect(text).toBe(
      [
        "수정: 2026-05-13T09:10:00.000Z",
        "",
        "준비물 확인",
      ].join("\n")
    );
  });

  it("combines visible memos and skips deleted memos", () => {
    const visible = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      title: "보이는 메모",
      plainText: "내용",
    };
    const hidden = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-2" }),
      title: "숨은 메모",
      plainText: "숨김 내용",
      windowState: {
        ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-2" }).windowState,
        visible: false,
      },
    };
    const deleted = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-3" }),
      title: "삭제된 메모",
      deletedAt: "2026-05-13T09:02:00.000Z",
    };

    const text = formatMemosAsCombinedText([visible, hidden, deleted]);
    const first = [
      "수정: 2026-05-13T09:00:00.000Z",
      "",
      "내용",
    ].join("\n");
    const second = [
      "수정: 2026-05-13T09:00:00.000Z",
      "",
      "숨김 내용",
    ].join("\n");

    expect(text).toContain("내용");
    expect(text).toContain("숨김 내용");
    expect(text).not.toContain("삭제된 메모");

    expect(text).toBe([first, second].join("\n\n---\n\n"));
  });
});
