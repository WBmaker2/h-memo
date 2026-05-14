import type { ChangeEvent } from "react";

export type SettingsPanelProps = {
  userName: string | null;
  backupStatus: string;
  startupEnabled: boolean;
  isStartupAvailable?: boolean;
  isServerAvailable?: boolean;
  isServerBusy?: boolean;
  isBackupDisabled?: boolean;
  isRestoreDisabled?: boolean;
  isAuthDisabled?: boolean;
  onBackup: () => void;
  onRestore: () => void;
  onExportText: () => void;
  onToggleStartup: (enabled: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
};

export function SettingsPanel({
  userName,
  backupStatus,
  startupEnabled,
  isStartupAvailable = true,
  isServerAvailable = true,
  isServerBusy = false,
  isBackupDisabled = false,
  isRestoreDisabled = false,
  isAuthDisabled = false,
  onBackup,
  onRestore,
  onExportText,
  onToggleStartup,
  onSignIn,
  onSignOut,
}: SettingsPanelProps) {
  const handleToggleStartup = (event: ChangeEvent<HTMLInputElement>) => {
    onToggleStartup(event.currentTarget.checked);
  };

  const handleAuthClick = () => {
    if (userName) {
      onSignOut();
    } else {
      onSignIn();
    }
  };

  return (
    <section className="settings-panel">
      <section className="settings-panel__section">
        <h4 className="settings-panel__section-title">계정</h4>
        <p>{userName || "로그인 필요"}</p>
        <button
          type="button"
          onClick={handleAuthClick}
          disabled={isAuthDisabled || !isServerAvailable}
          title={userName ? "로그아웃" : "로그인"}
        >
          {userName ? "로그아웃" : "로그인"}
        </button>
      </section>

      <section className="settings-panel__section">
        <h4 className="settings-panel__section-title">백업/복원</h4>
        <p role="status">{backupStatus}</p>
        <div>
          <button
            type="button"
            onClick={onBackup}
            disabled={isBackupDisabled || !isServerAvailable}
          >
            서버 백업
          </button>
          <button
            type="button"
            onClick={onRestore}
            disabled={isRestoreDisabled || !isServerAvailable}
          >
            서버 복원
          </button>
          <button
            type="button"
            onClick={onExportText}
            disabled={isServerBusy}
          >
            TXT 내보내기
          </button>
        </div>
      </section>

      <section className="settings-panel__section">
        <h4 className="settings-panel__section-title">시작프로그램</h4>
        <label>
          시작프로그램 등록
          <input
            type="checkbox"
            role="switch"
            aria-label="시작프로그램 등록"
            checked={startupEnabled}
            disabled={!isStartupAvailable}
            onChange={handleToggleStartup}
          />
        </label>
      </section>
    </section>
  );
}
