import type { ChangeEvent } from "react";

type SettingsPanelProps = {
  userName: string;
  backupStatus: string;
  startupEnabled: boolean;
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
      <header>
        <p>{userName || "로그인 필요"}</p>
        <button type="button" onClick={handleAuthClick}>
          {userName ? "로그아웃" : "로그인"}
        </button>
      </header>

      <p role="status">{backupStatus}</p>

      <div>
        <button type="button" onClick={onBackup}>
          서버 백업
        </button>
        <button type="button" onClick={onRestore}>
          서버 복원
        </button>
        <button type="button" onClick={onExportText}>
          TXT 내보내기
        </button>
      </div>

      <label>
        시작프로그램 등록
        <input
          type="checkbox"
          role="switch"
          aria-label="시작프로그램 등록"
          checked={startupEnabled}
          onChange={handleToggleStartup}
        />
      </label>
    </section>
  );
}
