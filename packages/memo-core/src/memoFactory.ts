import type { Memo, MemoStyle, MemoWindowState } from "./types";
import {
  DEFAULT_MEMO_STYLE,
  DEFAULT_MEMO_WINDOW_STATE,
} from "./types";

export type MemoFactoryInput = {
  id: string;
  now: string;
  title?: string;
  plainText?: string;
  richContent?: unknown;
  style?: Partial<MemoStyle>;
  windowState?: Partial<MemoWindowState>;
  syncState?: Memo["syncState"];
};

export function createMemo(input: MemoFactoryInput): Memo {
  return {
    id: input.id,
    title: input.title ?? "새 메모",
    plainText: input.plainText ?? "",
    richContent:
      input.richContent ??
      ({ type: "doc", content: [{ type: "paragraph" }] } as const),
    style: {
      ...DEFAULT_MEMO_STYLE,
      ...input.style,
    },
    windowState: {
      ...DEFAULT_MEMO_WINDOW_STATE,
      ...input.windowState,
    },
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    syncState: input.syncState ?? "local-only",
  };
}

export function renameMemo(
  memo: Memo,
  title: string,
  updatedAt: string
): Memo {
  const nextTitle = title.trim() || "새 메모";

  return {
    ...memo,
    title: nextTitle,
    updatedAt,
    syncState: "queued",
  };
}

export function updateMemoStyle(
  memo: Memo,
  style: Partial<Memo["style"]>,
  updatedAt: string
): Memo {
  return {
    ...memo,
    style: {
      ...memo.style,
      ...style,
    },
    updatedAt,
    syncState: "queued",
  };
}

export function updateMemoContent(
  memo: Memo,
  richContent: Memo["richContent"],
  plainText: string,
  updatedAt: string
): Memo {
  return {
    ...memo,
    richContent,
    plainText,
    updatedAt,
    syncState: "queued",
  };
}

export function updateMemoWindowState(
  memo: Memo,
  windowState: Partial<Memo["windowState"]>,
  updatedAt: string
): Memo {
  return {
    ...memo,
    windowState: {
      ...memo.windowState,
      ...windowState,
    },
    updatedAt,
    syncState: "queued",
  };
}

export function softDeleteMemo(memo: Memo, deletedAt: string): Memo {
  return {
    ...memo,
    deletedAt,
    updatedAt: deletedAt,
    syncState: "queued",
    windowState: {
      ...memo.windowState,
      visible: false,
    },
  };
}
