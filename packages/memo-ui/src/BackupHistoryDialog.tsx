import { useEffect, useRef, useState } from "react";

import { formatDateTime } from "./formatDateTime";

export type BackupHistoryItem = {
  id: string;
  savedAt: string | null;
  kstDate: string | null;
  memoCount: number;
  previewText: string;
  legacyUndated: boolean;
};

export type BackupHistoryDialogProps = {
  isOpen: boolean;
  isBusy: boolean;
  items: BackupHistoryItem[];
  pagination?: {
    pageNumber: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    onPreviousPage: () => void;
    onNextPage: () => void;
  };
  onClose: () => void;
  onRestore: (snapshotId: string) => void;
};

const DIALOG_TITLE_ID = "backup-history-dialog-title";
const ITEMS_PER_PAGE = 10;

export function BackupHistoryDialog({
  isOpen,
  isBusy,
  items,
  pagination,
  onClose,
  onRestore,
}: BackupHistoryDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const visiblePage = Math.min(currentPage, pageCount - 1);
  const visibleItems = pagination
    ? items
    : items.slice(
        visiblePage * ITEMS_PER_PAGE,
        (visiblePage + 1) * ITEMS_PER_PAGE,
      );
  const displayPage = pagination?.pageNumber ?? visiblePage + 1;
  const hasPreviousPage = pagination?.hasPreviousPage ?? visiblePage > 0;
  const hasNextPage = pagination?.hasNextPage ?? visiblePage < pageCount - 1;
  const showPagination = pagination
    ? pagination.hasPreviousPage || pagination.hasNextPage
    : items.length > ITEMS_PER_PAGE;

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(0);
    }
  }, [isOpen, items]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="backup-history-dialog-backdrop">
      <section
        className="backup-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={DIALOG_TITLE_ID}
      >
        <header className="backup-history-dialog__header">
          <h2 id={DIALOG_TITLE_ID}>백업 기록 선택</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        <p className="backup-history-dialog__description">
          복원할 백업 시간대를 선택해 주세요. 선택한 백업에 포함된 메모로 현재
          로컬 메모가 교체됩니다.
        </p>
        <ul className="backup-history-list">
          {visibleItems.map((item) => {
            const dateLabel = item.kstDate ?? "기존 백업";
            const preview = item.previewText || "메모 없음";

            return (
              <li key={item.id} className="backup-history-list__item">
                <div className="backup-history-list__content">
                  <strong>{dateLabel}</strong>
                  <span>
                    백업 시각: {formatDateTime(item.savedAt ?? "", "ko-KR", "Asia/Seoul")}
                  </span>
                  <span>백업 당시 {item.memoCount}개 메모</span>
                  <span title={preview}>미리보기: {preview}</span>
                </div>
                <div className="backup-history-list__actions">
                  <button
                    type="button"
                    aria-label={`${dateLabel} 백업 복원`}
                    disabled={isBusy}
                    onClick={() => onRestore(item.id)}
                  >
                    복원
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {showPagination ? (
          <nav className="backup-history-pagination" aria-label="백업 기록 페이지">
            <button
              type="button"
              aria-label="이전 페이지"
              disabled={isBusy || !hasPreviousPage}
              onClick={() => {
                if (pagination) pagination.onPreviousPage();
                else setCurrentPage((page) => Math.max(0, page - 1));
              }}
            >
              이전
            </button>
            <span className="backup-history-pagination__status" aria-live="polite">
              {pagination
                ? `${displayPage}페이지 · 최대 ${ITEMS_PER_PAGE}개씩 표시`
                : `전체 ${items.length}개 · ${displayPage} / ${pageCount} 페이지`}
            </span>
            <button
              type="button"
              aria-label="다음 페이지"
              disabled={isBusy || !hasNextPage}
              onClick={() => {
                if (pagination) pagination.onNextPage();
                else setCurrentPage((page) => Math.min(pageCount - 1, page + 1));
              }}
            >
              다음
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
