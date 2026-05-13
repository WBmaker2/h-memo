import type { Memo } from "./types";

function formatSingleMemo(memo: Memo): string {
  return `제목: ${memo.title}\n내용: ${memo.plainText}`;
}

export function formatMemoAsText(memo: Memo): string {
  return formatSingleMemo(memo).trim();
}

export function formatMemosAsCombinedText(memos: Memo[]): string {
  const visibleMemos = memos
    .filter((memo) => memo.deletedAt === null && memo.windowState.visible);

  if (visibleMemos.length === 0) {
    return "";
  }

  return visibleMemos.map(formatSingleMemo).join("\n\n");
}
