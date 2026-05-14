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
  onRequestWindowDrag?: () => void;
  onRequestWindowResize?: (direction: "SouthEast") => void;
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
  onRequestWindowDrag,
  onRequestWindowResize,
  settingsProps,
  actions,
}: MemoWorkspaceShellProps) {
  const hasMemos = memos.length > 0;

  return (
    <main className={appClassName}>
      <header className={`${appClassName}__chrome`}>
        <h1 className="visually-hidden">{title}</h1>
        <details className="workspace-menu">
          <summary aria-label="앱 메뉴" title="앱 메뉴">...</summary>
          <div className="workspace-menu__panel">
            {hasMemos ? (
              <button type="button" onClick={onCreateMemo}>
                새 메모
              </button>
            ) : null}
            <button type="button" onClick={onExportText}>
              TXT 미리보기
            </button>
            {actions}
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
            <pre aria-label="TXT 미리보기 결과" className={`${appClassName}__preview`}>
              {txtPreview}
            </pre>
          </div>
        </details>
      </header>

      <section className={`${appClassName}__memos`} aria-label="메모 목록">
        {hasMemos ? (
          memos.map((memo) => (
            <StickyMemo
              key={memo.id}
              memo={memo}
              onChange={onMemoChange}
              onHide={onHideMemo}
              onDelete={onDeleteMemo}
              onRequestWindowDrag={onRequestWindowDrag}
              onRequestWindowResize={onRequestWindowResize}
            />
          ))
        ) : (
          <div className={`${appClassName}__empty`}>
            <button type="button" onClick={onCreateMemo}>
              새 메모
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
