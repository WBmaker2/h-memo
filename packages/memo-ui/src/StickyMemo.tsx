import { type ChangeEvent, useEffect, useState } from "react";
import { renameMemo, type Memo, updateMemoContent, updateMemoStyle } from "@h-memo/memo-core";
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

  const updateMeta = (nextMemo: Memo) => {
    setEditingMemo(nextMemo);
    onChange(nextMemo);
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const now = new Date().toISOString();
    updateMeta({
      ...editingMemo,
      title: value,
      updatedAt: now,
      syncState: "queued",
    });
  };

  const handleTitleBlur = () => {
    if (editingMemo.title.trim() !== editingMemo.title) {
      updateMeta(renameMemo(editingMemo, editingMemo.title, new Date().toISOString()));
    }
  };

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextMemo = updateMemoContent(
      editingMemo,
      editingMemo.richContent,
      event.target.value,
      new Date().toISOString()
    );
    updateMeta(nextMemo);
  };

  const handleStyleChange = (style: Partial<Memo["style"]>) => {
    const nextMemo = updateMemoStyle(editingMemo, style, new Date().toISOString());
    updateMeta(nextMemo);
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
        onBlur={handleTitleBlur}
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
