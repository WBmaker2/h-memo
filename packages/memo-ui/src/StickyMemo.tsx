import {
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  extractPlainText,
  type Memo,
  updateMemoContent,
  updateMemoStyle,
} from "@h-memo/memo-core";
import { MemoToolbar } from "./MemoToolbar";

type StickyMemoProps = {
  memo: Memo;
  appMenuContent?: ReactNode;
  onChange: (memo: Memo) => void;
  onDelete: (memoId: string) => void;
  onRequestWindowDrag?: () => void;
  onRequestWindowResize?: (direction: "SouthEast") => void;
  onRequestWindowMinimize?: () => void;
  onRequestWindowMaximize?: () => void;
  onRequestWindowClose?: () => void;
  onRequestCollapseChange?: (collapsed: boolean) => void;
};

export function StickyMemo({
  memo,
  appMenuContent,
  onChange,
  onDelete,
  onRequestWindowDrag,
  onRequestWindowResize,
  onRequestWindowMinimize,
  onRequestWindowMaximize,
  onRequestWindowClose,
  onRequestCollapseChange,
}: StickyMemoProps) {
  const [editingMemo, setEditingMemo] = useState<Memo>(memo);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const shouldShowWindowControls = Boolean(
    onRequestWindowMinimize || onRequestWindowMaximize || onRequestWindowClose
  );

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

  const handleWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button > 0) {
      return;
    }
    if ((event.target as HTMLElement).closest("[data-no-window-drag='true']")) {
      return;
    }
    if (event.detail > 1) {
      return;
    }
    onRequestWindowDrag?.();
  };

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("[data-no-window-drag='true']")) {
      return;
    }
    const nextCollapsed = !isCollapsed;
    setIsCollapsed(nextCollapsed);
    onRequestCollapseChange?.(nextCollapsed);
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
      className={isCollapsed ? "sticky-memo sticky-memo--collapsed" : "sticky-memo"}
      style={{
        backgroundColor: editingMemo.style.backgroundColor,
        color: editingMemo.style.textColor,
        fontFamily: editingMemo.style.fontFamily,
        fontSize: `${editingMemo.style.fontSize}px`,
      }}
    >
      <div
        className="sticky-memo__titlebar"
        data-tauri-drag-region
        aria-label="상단 메뉴바"
        title="드래그해서 이동, 더블클릭해서 접기/펼치기"
        onMouseDown={handleWindowDrag}
        onDoubleClick={handleTitlebarDoubleClick}
      >
        <details className="memo-menu" data-no-window-drag="true">
          <summary
            aria-label="메모 메뉴"
            title="메모 메뉴"
            data-no-window-drag="true"
          >
            ...
          </summary>
          <div className="memo-menu__panel">
            <section className="memo-menu__section">
              <h3 className="memo-menu__section-title">메모 스타일</h3>
              <MemoToolbar
                style={editingMemo.style}
                onStyleChange={handleStyleChange}
                onDelete={() => onDelete(editingMemo.id)}
                showDeleteAction={!appMenuContent}
              />
            </section>
            {appMenuContent ? (
              <section className="memo-menu__section" aria-label="메모 메뉴">
                {appMenuContent}
              </section>
            ) : null}
          </div>
        </details>
        <div className="sticky-memo__titlebar-drag" data-tauri-drag-region>
          H Memo
        </div>
        {shouldShowWindowControls ? (
          <div className="sticky-memo__window-controls" data-no-window-drag="true">
            <button
              type="button"
              aria-label="최소화"
              title="최소화"
              onClick={onRequestWindowMinimize}
            >
              _
            </button>
            <button
              type="button"
              aria-label="최대화"
              title="최대화"
              onClick={onRequestWindowMaximize}
            >
              □
            </button>
            <button
              type="button"
              aria-label="종료"
              title="종료"
              onClick={onRequestWindowClose}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      {isCollapsed ? null : (
        <>
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
        </>
      )}
    </article>
  );
}
