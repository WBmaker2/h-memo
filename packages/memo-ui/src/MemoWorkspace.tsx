import { type ReactNode } from "react";
import { type Memo } from "@h-memo/memo-core";
import { StickyMemo } from "./StickyMemo";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";

type MemoWorkspaceShellProps = {
  appClassName: string;
  title: string;
  memos: Memo[];
  txtPreview: string;
  actions?: ReactNode;
  onCreateMemo: () => void;
  onExportText: () => void;
  onMemoChange: (memo: Memo) => void;
  onHideMemo: (memoId: string) => void;
  onDeleteMemo: (memoId: string) => void;
  settingsProps: SettingsPanelProps;
};

export function MemoWorkspace({
  appClassName,
  title,
  memos,
  txtPreview,
  onCreateMemo,
  onExportText,
  onMemoChange,
  onHideMemo,
  onDeleteMemo,
  settingsProps,
  actions,
}: MemoWorkspaceShellProps) {
  return (
    <main className={appClassName}>
      <header className={`${appClassName}__header`}>
        <h1>{title}</h1>
      </header>

      <section className={`${appClassName}__actions`}>
        <button type="button" onClick={onCreateMemo}>
          새 메모
        </button>
        <button type="button" onClick={onExportText}>
          TXT 미리보기
        </button>
        {actions}
      </section>

      <section className={`${appClassName}__memos`} aria-label="메모 목록">
        {memos.map((memo) => (
          <StickyMemo
            key={memo.id}
            memo={memo}
            onChange={onMemoChange}
            onHide={onHideMemo}
            onDelete={onDeleteMemo}
          />
        ))}
      </section>

      <pre aria-label="TXT 미리보기 결과" className={`${appClassName}__preview`}>
        {txtPreview}
      </pre>

      <SettingsPanel
        userName={settingsProps.userName}
        backupStatus={settingsProps.backupStatus}
        startupEnabled={settingsProps.startupEnabled}
        isStartupAvailable={settingsProps.isStartupAvailable}
        isServerAvailable={settingsProps.isServerAvailable}
        isServerBusy={settingsProps.isServerBusy}
        isBackupDisabled={settingsProps.isBackupDisabled}
        isRestoreDisabled={settingsProps.isRestoreDisabled}
        isAuthDisabled={settingsProps.isAuthDisabled}
        onBackup={settingsProps.onBackup}
        onRestore={settingsProps.onRestore}
        onExportText={settingsProps.onExportText}
        onToggleStartup={settingsProps.onToggleStartup}
        onSignIn={settingsProps.onSignIn}
        onSignOut={settingsProps.onSignOut}
      />
    </main>
  );
}
