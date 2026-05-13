import { type ChangeEvent, useEffect, useState } from "react";
import {
  extractPlainText,
  renameMemo,
  type Memo,
  updateMemoContent,
  updateMemoStyle,
} from "@h-memo/memo-core";
import { MemoToolbar } from "./MemoToolbar";

type StickyMemoProps = {
  memo: Memo;
  onChange: (memo: Memo) => void;
  onHide: (memoId: string) => void;
  onDelete: (memoId: string) => void;
};

export function StickyMemo({ memo, onChange, onHide, onDelete }: StickyMemoProps) {
  const [editingMemo, setEditingMemo] = useState<Memo>(memo);

  useEffect(() => {
    setEditingMemo(memo);
  }, [memo]);

  const commitMemo = (nextMemo: Memo) => {
    setEditingMemo(nextMemo);
    onChange(nextMemo);
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const now = new Date().toISOString();
    const nextMemo = renameMemo(editingMemo, value, now);
    commitMemo(nextMemo);
  };

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const now = new Date().toISOString();
    const text = event.target.value;
    const richContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    };
    const nextMemo = updateMemoContent(
      editingMemo,
      richContent,
      extractPlainText(richContent),
      now
    );
    commitMemo(nextMemo);
  };

  const handleStyleChange = (style: Partial<Memo["style"]>) => {
    const now = new Date().toISOString();
    const nextMemo = updateMemoStyle(editingMemo, style, now);
    commitMemo(nextMemo);
  };

  return (
    <article
      className="sticky-memo"
      style={{
        backgroundColor: editingMemo.style.backgroundColor,
        color: editingMemo.style.textColor,
        fontFamily: editingMemo.style.fontFamily,
        fontSize: `${editingMemo.style.fontSize}px`,
      }}
    >
      <input
        aria-label="메모 제목"
        value={editingMemo.title}
        onChange={handleTitleChange}
      />
      <textarea
        aria-label="메모 내용"
        value={editingMemo.plainText}
        onChange={handleContentChange}
      />
      <MemoToolbar
        style={editingMemo.style}
        onStyleChange={handleStyleChange}
        onHide={() => onHide(editingMemo.id)}
        onDelete={() => onDelete(editingMemo.id)}
      />
    </article>
  );
}
