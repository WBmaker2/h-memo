import { useEffect, useRef, useState } from "react";
import { AppUpdateDialog } from "@h-memo/memo-ui";

import { useDesktopUpdater } from "./useDesktopUpdater";

type DesktopUpdatePromptProps = {
  enabled: boolean;
  blocked: boolean;
  beforeInstall?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onInstallingChange?: (installing: boolean) => void;
};

export const DESKTOP_UPDATE_CHECK_EVENT = "h-memo:check-desktop-updates";

export function DesktopUpdatePrompt({
  enabled,
  blocked,
  beforeInstall,
  onBusyChange,
  onInstallingChange,
}: DesktopUpdatePromptProps) {
  const updater = useDesktopUpdater({ enabled, blocked, beforeInstall });
  const [manualCheckOpen, setManualCheckOpen] = useState(false);
  const closeManualCheckRef = useRef<HTMLButtonElement | null>(null);
  const { phase, update } = updater;

  useEffect(() => {
    onBusyChange?.(phase === "checking" || phase === "installing");
    return () => onBusyChange?.(false);
  }, [onBusyChange, phase]);

  useEffect(() => {
    onInstallingChange?.(phase === "installing");
    return () => onInstallingChange?.(false);
  }, [onInstallingChange, phase]);

  useEffect(() => {
    if (!enabled) return;
    const requestCheck = () => {
      if (blocked) return;
      setManualCheckOpen(true);
      void updater.checkNow();
    };
    window.addEventListener(DESKTOP_UPDATE_CHECK_EVENT, requestCheck);
    return () => window.removeEventListener(DESKTOP_UPDATE_CHECK_EVENT, requestCheck);
  }, [blocked, enabled, updater.checkNow]);

  const hasManualStatus =
    manualCheckOpen && !blocked && !update && (phase === "checking" || phase === "up-to-date" || phase === "error");

  useEffect(() => {
    if (!hasManualStatus) return;
    closeManualCheckRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManualCheckOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [hasManualStatus]);

  if (hasManualStatus) {
    const title = phase === "checking" ? "업데이트 확인 중" : phase === "up-to-date" ? "최신 버전입니다" : "업데이트를 확인하지 못했습니다";
    return (
      <div className="app-update-dialog-backdrop">
        <section className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-update-title">
          <h2 id="manual-update-title">{title}</h2>
          <p role={phase === "error" ? "alert" : "status"}>
            {phase === "checking" ? "Windows 앱 업데이트 서버에 연결하고 있습니다." : phase === "up-to-date" ? "설치된 프로그램이 공개된 최신 버전입니다." : updater.errorMessage}
          </p>
          <div className="app-update-dialog__actions">
            {phase === "error" ? <button type="button" onClick={() => void updater.checkNow()}>다시 확인</button> : null}
            <button ref={closeManualCheckRef} type="button" onClick={() => setManualCheckOpen(false)}>닫기</button>
          </div>
        </section>
      </div>
    );
  }

  if (
    !enabled ||
    !update ||
    (phase !== "available" &&
      phase !== "installing" &&
      phase !== "error" &&
      phase !== "installed")
  ) {
    return null;
  }

  if (blocked && phase !== "installing" && phase !== "installed") {
    return null;
  }

  return (
    <AppUpdateDialog
      isOpen
      phase={phase}
      currentVersion={update.currentVersion}
      version={update.version}
      releaseNotes={update.releaseNotes}
      downloadedBytes={updater.downloadedBytes}
      totalBytes={updater.totalBytes}
      errorMessage={updater.errorMessage}
      onAccept={phase === "installed" ? updater.decline : updater.accept}
      onDecline={updater.decline}
    />
  );
}
