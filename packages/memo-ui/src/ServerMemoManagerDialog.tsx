import type { BackedUpMemo } from "@h-memo/memo-sync";

export type ServerMemoManagerDialogProps = {
  isOpen: boolean;
  isBusy: boolean;
  items: BackedUpMemo[];
  status: string;
  onClose: () => void;
  onRefresh: () => void;
  onRestore: (memoId: string) => void;
  onDelete: (memoId: string) => void;
};

function getMemoLabel(plainText: string, fallback: string) {
  return plainText.trim().replace(/\s+/g, " ") || fallback;
}

type Props = ServerMemoManagerDialogProps;

export function ServerMemoManagerDialog({
  isOpen,
  isBusy,
  items,
  status,
  onClose,
  onRefresh,
  onRestore,
  onDelete,
}: Props) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="server-memo-dialog-backdrop">
      <section
        className="server-memo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="서버 메모 관리"
      >
        <header className="server-memo-dialog__header">
          <h2>서버 메모 관리</h2>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        <p className="server-memo-dialog__description">
          DB에 저장된 메모를 확인하고 필요한 메모는 복원할 수 있습니다.
        </p>
        <p role="status">{status}</p>
        <div className="server-memo-dialog__toolbar">
          <button type="button" onClick={onRefresh} disabled={isBusy}>
            새로고침
          </button>
        </div>
        {items.length > 0 ? (
          <ul className="server-memo-list">
            {items.map((item, index) => {
              const label = getMemoLabel(item.memo.plainText, `빈 메모 ${index + 1}`);

              return (
                <li key={item.memo.id} className="server-memo-list__item">
                  <div className="server-memo-list__content">
                    <strong>{label}</strong>
                    <span>백업 시각: {item.backupCreatedAt}</span>
                    {item.memo.deletedAt ? <span>로컬 삭제 기록 있음</span> : null}
                  </div>
                  <div className="server-memo-list__actions">
                    <button
                      type="button"
                      aria-label={`${label} 복원`}
                      disabled={isBusy}
                      onClick={() => onRestore(item.memo.id)}
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      aria-label={`${label} 서버 삭제`}
                      disabled={isBusy}
                      onClick={() => onDelete(item.memo.id)}
                    >
                      서버 삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="server-memo-list__empty">서버에 저장된 메모가 없습니다.</p>
        )}
      </section>
    </div>
  );
}
