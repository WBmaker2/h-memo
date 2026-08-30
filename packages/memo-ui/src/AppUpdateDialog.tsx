import { useEffect, useRef, useState, type FormEvent } from "react";

export type AppUpdateDialogPhase = "available" | "installing" | "error" | "installed";
export type UpdateSnoozePeriod = "week" | "month";

export type AppUpdateDialogProps = {
  isOpen: boolean;
  phase: AppUpdateDialogPhase;
  currentVersion: string;
  version: string;
  releaseNotes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
  onAccept: () => void;
  onDecline: (snoozePeriod?: UpdateSnoozePeriod) => void;
};

const DIALOG_TITLE_ID = "app-update-dialog-title";
const DIALOG_DESCRIPTION_ID = "app-update-dialog-description";
const DIALOG_STATUS_ID = "app-update-dialog-status";

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )
  );
}

function displayVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("ko-KR")}바이트`;
}

export function AppUpdateDialog({
  isOpen,
  phase,
  currentVersion,
  version,
  releaseNotes,
  downloadedBytes,
  totalBytes,
  errorMessage,
  onAccept,
  onDecline,
}: AppUpdateDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const isBusyRef = useRef(phase === "installing");
  const selectedSnoozePeriodRef = useRef<UpdateSnoozePeriod | null>(null);
  const onDeclineRef = useRef<(snoozePeriod?: UpdateSnoozePeriod) => void>(onDecline);
  const [selectedSnoozePeriod, setSelectedSnoozePeriod] = useState<UpdateSnoozePeriod | null>(null);
  isBusyRef.current = phase === "installing";
  onDeclineRef.current = onDecline;

  useEffect(() => {
    if (!isOpen) return;

    selectedSnoozePeriodRef.current = null;
    setSelectedSnoozePeriod(null);
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusyRef.current) {
        event.preventDefault();
        onDeclineRef.current(selectedSnoozePeriodRef.current ?? undefined);
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

  const handleSnoozePeriodChange = (period: UpdateSnoozePeriod) => {
    const nextPeriod = selectedSnoozePeriodRef.current === period ? null : period;
    selectedSnoozePeriodRef.current = nextPeriod;
    setSelectedSnoozePeriod(nextPeriod);
  };

  const handleDecline = () => {
    onDecline(selectedSnoozePeriodRef.current ?? undefined);
  };

  if (!isOpen) return null;

  const isInstalling = phase === "installing";
  const isInstalled = phase === "installed";
  const isError = phase === "error";
  const progressPercent =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;
  const statusMessage = isInstalling
    ? progressPercent === null
      ? `업데이트 파일을 다운로드하는 중입니다. ${formatBytes(downloadedBytes)}`
      : `업데이트 파일을 다운로드하는 중입니다. ${progressPercent}%`
    : isInstalled
      ? "업데이트 설치를 시작했습니다. Windows에서 앱이 곧 닫힙니다."
      : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isInstalling) onAccept();
  };

  return (
    <div className="app-update-dialog-backdrop">
      <section
        ref={dialogRef}
        className="app-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={isInstalling}
        aria-labelledby={DIALOG_TITLE_ID}
        aria-describedby={`${DIALOG_DESCRIPTION_ID} ${DIALOG_STATUS_ID}`}
      >
        <h2 id={DIALOG_TITLE_ID}>
          프로그램을 {displayVersion(version)}(최신 버전)으로 업그레이드하시겠습니까?
        </h2>
        <p id={DIALOG_DESCRIPTION_ID} className="app-update-dialog__description">
          현재 버전 {displayVersion(currentVersion)}입니다. 기존 프로그램을 먼저 삭제하지 않아도 업데이트할 수 있습니다.
        </p>
        {releaseNotes ? (
          <div className="app-update-dialog__notes">
            <strong>이번 업데이트</strong>
            <p>{releaseNotes}</p>
          </div>
        ) : null}
        {!isInstalled ? (
          <fieldset className="app-update-dialog__snooze" disabled={isInstalling}>
            <legend>다시 안내 시점 (선택 사항)</legend>
            <p>아니요를 누르면 선택한 기간 동안 업데이트 안내를 표시하지 않습니다.</p>
            <label>
              <input
                type="checkbox"
                checked={selectedSnoozePeriod === "week"}
                onChange={() => handleSnoozePeriodChange("week")}
              />
              1주일 뒤에 다시 안내
            </label>
            <label>
              <input
                type="checkbox"
                checked={selectedSnoozePeriod === "month"}
                onChange={() => handleSnoozePeriodChange("month")}
              />
              1달 뒤에 다시 안내
            </label>
          </fieldset>
        ) : null}
        <div id={DIALOG_STATUS_ID} className="app-update-dialog__status" role="status" aria-live="polite">
          {statusMessage}
          {isError ? <span role="alert">{errorMessage}</span> : null}
        </div>
        {isInstalling ? (
          <div className="app-update-dialog__progress" aria-label="업데이트 다운로드 진행률">
            {progressPercent === null ? (
              <progress />
            ) : (
              <progress max={100} value={progressPercent} />
            )}
            <span>
              {progressPercent === null
                ? formatBytes(downloadedBytes)
                : `${progressPercent}% · ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes ?? 0)}`}
            </span>
          </div>
        ) : null}
        <form className="app-update-dialog__actions" onSubmit={handleSubmit}>
          {!isInstalled ? (
            <button type="button" onClick={handleDecline} disabled={isInstalling}>
              아니요
            </button>
          ) : null}
          <button
            ref={primaryButtonRef}
            type="submit"
            className="app-update-dialog__accept"
            disabled={isInstalling}
          >
            {isInstalled ? "확인" : isError ? "다시 시도" : "예"}
          </button>
        </form>
      </section>
    </div>
  );
}
