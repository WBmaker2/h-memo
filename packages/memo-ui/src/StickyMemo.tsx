import { type ChangeEvent, type PointerEvent, useEffect, useState } from "react";
import {
  extractPlainText,
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
  onRequestWindowDrag?: () => void;
  onRequestWindowResize?: (direction: "SouthEast") => void;
};

export function StickyMemo({
  memo,
  onChange,
  onHide,
  onDelete,
  onRequestWindowDrag,
  onRequestWindowResize,
}: StickyMemoProps) {
  const [editingMemo, setEditingMemo] = useState<Memo>(memo);

  useEffect(() => {
    setEditingMemo(memo);
  }, [memo]);

  const commitMemo = (nextMemo: Memo) => {
    setEditingMemo(nextMemo);
    onChange(nextMemo);
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

  const handleWindowDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button > 0) {
      return;
    }
    onRequestWindowDrag?.();
  };

  const handleWindowResize = (event: PointerEvent<HTMLElement>) => {
    if (event.button > 0) {
      return;
    }
    event.preventDefault();
    onRequestWindowResize?.("SouthEast");
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
      <div
        className="sticky-memo__drag-region"
        data-tauri-drag-region
        aria-label="창 이동 영역"
        title="드래그해서 이동"
        onPointerDown={handleWindowDrag}
      />
      <header className="sticky-memo__header">
        <div
          className="sticky-memo__drag-spacer"
          data-tauri-drag-region
          onPointerDown={handleWindowDrag}
        />
        <details className="memo-menu">
          <summary aria-label="메모 메뉴" title="메모 메뉴">...</summary>
          <div className="memo-menu__panel">
            <MemoToolbar
              style={editingMemo.style}
              onStyleChange={handleStyleChange}
              onHide={() => onHide(editingMemo.id)}
              onDelete={() => onDelete(editingMemo.id)}
            />
          </div>
        </details>
      </header>
      <textarea
        aria-label="메모 내용"
        value={editingMemo.plainText}
        onChange={handleContentChange}
      />
      <div
        className="sticky-memo__resize-handle"
        aria-label="창 크기 조절"
        title="드래그해서 크기 조절"
        onPointerDown={handleWindowResize}
      />
    </article>
  );
}
