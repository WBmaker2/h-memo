import { describe, expect, it } from "vitest";
import { createMemo } from "./memoFactory";
import { formatMemoAsText, formatMemosAsCombinedText } from "./exportText";

describe("text export", () => {
  it("formats one memo as text", () => {
    const memo = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      title: "수업 준비",
      plainText: "준비물 확인",
    };

    const text = formatMemoAsText(memo);

    expect(text).toContain("제목: 수업 준비");
    expect(text).toContain("준비물 확인");
  });

  it("combines visible memos and skips deleted memos", () => {
    const visible = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-1" }),
      title: "보이는 메모",
      plainText: "내용",
    };
    const deleted = {
      ...createMemo({ now: "2026-05-13T09:00:00.000Z", id: "memo-2" }),
      title: "삭제된 메모",
      deletedAt: "2026-05-13T09:02:00.000Z",
    };

    const text = formatMemosAsCombinedText([visible, deleted]);

    expect(text).toContain("보이는 메모");
    expect(text).not.toContain("삭제된 메모");
  });
});
