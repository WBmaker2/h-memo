import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

import { formatDateTime } from "./formatDateTime";

export type StartupServerRestoreDialogProps = {
  isOpen: boolean;
  isBusy: boolean;
  local: {
    memoCount: number;
    updatedAt: string | null;
  };
  server: {
    memoCount: number;
    savedAt: string | null;
  };
  errorMessage?: string | null;
  statusMessage?: ReactNode;
  onAccept: () => void;
  onDecline: () => void;
};

const DIALOG_TITLE_ID = "startup-server-restore-dialog-title";
const DIALOG_DESCRIPTION_ID = "startup-server-restore-dialog-description";
const DIALOG_STATUS_ID = "startup-server-restore-dialog-status";

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )
  );
}

export function StartupServerRestoreDialog({
  isOpen,
  isBusy,
  local,
  server,
  errorMessage,
  statusMessage,
  onAccept,
  onDecline,
}: StartupServerRestoreDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const acceptButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const isBusyRef = useRef(isBusy);
  const onDeclineRef = useRef(onDecline);
  isBusyRef.current = isBusy;
  onDeclineRef.current = onDecline;

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acceptButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusyRef.current) {
        event.preventDefault();
        onDeclineRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const previous = previousActiveElementRef.current;
      if (previous && document.contains(previous)) previous.focus();
      previousActiveElementRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isBusy) onAccept();
  };

  return (
    <div className="startup-server-restore-dialog-backdrop">
      <section
        ref={dialogRef}
        className="startup-server-restore-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={isBusy}
        aria-labelledby={DIALOG_TITLE_ID}
        aria-describedby={`${DIALOG_DESCRIPTION_ID} ${DIALOG_STATUS_ID}`}
      >
        <h2 id={DIALOG_TITLE_ID}>더 최근 서버 메모가 있습니다</h2>
        <p id={DIALOG_DESCRIPTION_ID} className="startup-server-restore-dialog__description">
          서버에 저장된 최근 버전의 메모를 불러오시겠습니까?
        </p>
        <dl className="startup-server-restore-dialog__versions">
          <div>
            <dt>로컬</dt>
            <dd>
              {formatDateTime(local.updatedAt ?? "")} · {local.memoCount}개 메모
            </dd>
          </div>
          <div>
            <dt>서버</dt>
            <dd>
              {formatDateTime(server.savedAt ?? "")} · {server.memoCount}개 메모
            </dd>
          </div>
        </dl>
        <p className="startup-server-restore-dialog__safety">
          현재 로컬 메모는 복원 전 안전 지점으로 보관됩니다. 복원 후에도 설정에서 한 번 되돌릴 수 있습니다.
        </p>
        <div id={DIALOG_STATUS_ID} className="startup-server-restore-dialog__status" role="status" aria-live="polite">
          {isBusy && !errorMessage ? statusMessage ?? "서버 메모를 불러오는 중입니다." : null}
          {errorMessage ? <span role="alert">{errorMessage}</span> : null}
        </div>
        <form className="startup-server-restore-dialog__actions" onSubmit={handleSubmit}>
          <button type="button" onClick={onDecline} disabled={isBusy}>
            아니요, 로컬 유지
          </button>
          <button ref={acceptButtonRef} type="submit" disabled={isBusy} className="startup-server-restore-dialog__accept">
            {errorMessage ? "다시 시도 ↵" : "예, 서버 메모 불러오기 ↵"}
          </button>
        </form>
      </section>
    </div>
  );
}
