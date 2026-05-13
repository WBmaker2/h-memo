import type { Memo } from "./types";

function formatSingleMemo(memo: Memo): string {
  return [
    `제목: ${memo.title}`,
    `수정: ${memo.updatedAt}`,
    "",
    memo.plainText,
  ].join("\n");
}

export function formatMemoAsText(memo: Memo): string {
  return formatSingleMemo(memo).trim();
}

export function formatMemosAsCombinedText(memos: Memo[]): string {
  const visibleMemos = memos.filter((memo) => memo.deletedAt === null);

  if (visibleMemos.length === 0) {
    return "";
  }

  return visibleMemos.map(formatSingleMemo).join("\n\n---\n\n");
}
