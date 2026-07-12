import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  extractPlainText,
  type Memo,
  updateMemoContent,
  updateMemoStyle,
} from "@h-memo/memo-core";
import { MemoToolbar } from "./MemoToolbar";

const MEMO_MENU_OPENED_EVENT = "h-memo:memo-menu-opened";

type StickyMemoProps = {
  memo: Memo;
  appVersion?: string;
  appMenuContent?: ReactNode;
  authStatus?: {
    state: "signed-in" | "signed-out" | "unavailable";
    label: string;
    photoUrl?: string;
  };
  onChange: (memo: Memo) => void;
  onDelete: (memoId: string) => void;
  onCloseMemo?: (memoId: string) => void;
  onRequestWindowDrag?: () => void;
  onRequestWindowResize?: (direction: "SouthEast") => void;
  onRequestWindowClose?: () => void;
  onRequestCollapseChange?: (collapsed: boolean) => void;
  onRequestSync?: () => void;
  isSyncDisabled?: boolean;
  isSyncBusy?: boolean;
  isEditingDisabled?: boolean;
};

export function StickyMemo({
  memo,
  appVersion,
  appMenuContent,
  authStatus,
  onChange,
  onDelete,
  onCloseMemo,
  onRequestWindowDrag,
  onRequestWindowResize,
  onRequestWindowClose,
  onRequestCollapseChange,
  onRequestSync,
  isSyncDisabled = false,
  isSyncBusy = false,
  isEditingDisabled = false,
}: StickyMemoProps) {
  const [editingMemo, setEditingMemo] = useState<Memo>(memo);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const memoMenuRef = useRef<HTMLDetailsElement | null>(null);
  const memoMenuSummaryRef = useRef<HTMLElement | null>(null);
  const hasNativeWindowDrag = Boolean(onRequestWindowDrag);
  const hasNativeWindowResize = Boolean(onRequestWindowResize);
  const shouldShowSyncAction = Boolean(onRequestSync);
  const shouldShowWindowControls = Boolean(
    authStatus || onCloseMemo || onRequestWindowClose || shouldShowSyncAction
  );
  const isTopbarSyncDisabled = isSyncDisabled || isSyncBusy || !onRequestSync;
  const memoCloseLabel = editingMemo.plainText.trim().replace(/\s+/g, " ")
    ? `${editingMemo.plainText.trim().replace(/\s+/g, " ")} 메모창 닫기`
    : "빈 메모창 닫기";

  useEffect(() => {
    setEditingMemo(memo);
  }, [memo]);

  useEffect(() => {
    const closeWhenAnotherMemoMenuOpens = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === memo.id) {
        return;
      }
      if (memoMenuRef.current?.open) {
        memoMenuRef.current.open = false;
      }
    };

    window.addEventListener(MEMO_MENU_OPENED_EVENT, closeWhenAnotherMemoMenuOpens);

    return () => {
      window.removeEventListener(MEMO_MENU_OPENED_EVENT, closeWhenAnotherMemoMenuOpens);
    };
  }, [memo.id]);

  const commitMemo = (nextMemo: Memo) => {
    if (isEditingDisabled) {
      return;
    }
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

  const handleMemoMenuToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) {
      return;
    }
    window.dispatchEvent(new CustomEvent(MEMO_MENU_OPENED_EVENT, { detail: editingMemo.id }));
  };

  const handleMemoMenuKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !event.currentTarget.open) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    memoMenuSummaryRef.current?.focus();
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
        className={
          hasNativeWindowDrag
            ? "sticky-memo__titlebar sticky-memo__titlebar--draggable"
            : "sticky-memo__titlebar"
        }
        data-tauri-drag-region={hasNativeWindowDrag ? "" : undefined}
        aria-label="상단 메뉴바"
        title={hasNativeWindowDrag ? "드래그해서 이동, 더블클릭해서 접기/펼치기" : undefined}
        onMouseDown={hasNativeWindowDrag ? handleWindowDrag : undefined}
        onDoubleClick={onRequestCollapseChange ? handleTitlebarDoubleClick : undefined}
      >
        <details
          ref={memoMenuRef}
          className="memo-menu"
          data-no-window-drag={hasNativeWindowDrag ? "true" : undefined}
          onKeyDown={handleMemoMenuKeyDown}
          onToggle={handleMemoMenuToggle}
        >
          <summary
            ref={memoMenuSummaryRef}
            aria-label="메모 메뉴"
            title="메모 메뉴"
            data-no-window-drag={hasNativeWindowDrag ? "true" : undefined}
          >
            ...
          </summary>
          <div className="memo-menu__panel">
            <section className="memo-menu__section">
              <h2 className="memo-menu__section-title">메모 스타일</h2>
              <MemoToolbar
                style={editingMemo.style}
                onStyleChange={handleStyleChange}
                onDelete={() => onDelete(editingMemo.id)}
                showDeleteAction={!appMenuContent}
                isDisabled={isEditingDisabled}
              />
            </section>
            {appMenuContent ? (
              <section className="memo-menu__section" aria-label="메모 메뉴">
                {appMenuContent}
              </section>
            ) : null}
          </div>
        </details>
        <div
          className={
            hasNativeWindowDrag
              ? "sticky-memo__titlebar-drag"
              : "sticky-memo__titlebar-title"
          }
          data-tauri-drag-region={hasNativeWindowDrag ? "" : undefined}
        >
          <span className="sticky-memo__app-title">H Memo</span>
          {appVersion ? <span className="sticky-memo__app-version">{appVersion}</span> : null}
        </div>
        {shouldShowWindowControls ? (
          <div className="sticky-memo__window-controls" data-no-window-drag="true">
            {shouldShowSyncAction ? (
              <button
                type="button"
                className="sticky-memo__sync-button"
                aria-label="동기화"
                title={
                  isSyncDisabled
                    ? "구글 로그인 후 동기화 가능"
                    : isSyncBusy
                      ? "동기화 중"
                      : "서버 백업"
                }
                disabled={isTopbarSyncDisabled}
                onClick={onRequestSync}
              >
                <span aria-hidden="true">{isSyncBusy ? "..." : "↻"}</span>
              </button>
            ) : null}
            {authStatus ? (
              <div
                className={`sticky-memo__auth-status sticky-memo__auth-status--${authStatus.state}`}
                aria-label={
                  authStatus.state === "signed-in"
                    ? `구글 로그인됨: ${authStatus.label}`
                    : authStatus.state === "unavailable"
                      ? "구글 로그인 설정 필요"
                      : "구글 로그인 안 됨"
                }
                title={
                  authStatus.state === "signed-in"
                    ? `구글 로그인됨: ${authStatus.label}`
                    : authStatus.state === "unavailable"
                      ? "구글 로그인 설정 필요"
                      : "구글 로그인 안 됨"
                }
              >
                {authStatus.photoUrl ? (
                  <img src={authStatus.photoUrl} alt="" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">G</span>
                )}
              </div>
            ) : null}
            {onCloseMemo ? (
              <button
                type="button"
                aria-label={memoCloseLabel}
                title="메모창 닫기"
                disabled={isEditingDisabled}
                onClick={() => onCloseMemo(editingMemo.id)}
              >
                ×
              </button>
            ) : null}
            {onRequestWindowClose ? (
              <button
                type="button"
                aria-label="종료"
                title="종료"
                disabled={isEditingDisabled}
                onClick={onRequestWindowClose}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isCollapsed ? null : (
        <>
          <textarea
            aria-label="메모 내용"
            value={editingMemo.plainText}
            onChange={handleContentChange}
            readOnly={isEditingDisabled}
          />
          {hasNativeWindowResize ? (
            <div
              className="sticky-memo__resize-handle"
              aria-label="창 크기 조절"
              title="드래그해서 크기 조절"
              onPointerDown={handleWindowResize}
            />
          ) : null}
        </>
      )}
    </article>
  );
}
