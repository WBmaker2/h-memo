import { AppUpdateDialog } from "@h-memo/memo-ui";

import { useDesktopUpdater } from "./useDesktopUpdater";

type DesktopUpdatePromptProps = {
  enabled: boolean;
  blocked: boolean;
};

export function DesktopUpdatePrompt({
  enabled,
  blocked,
}: DesktopUpdatePromptProps) {
  const updater = useDesktopUpdater({ enabled, blocked });
  const { phase, update } = updater;

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
