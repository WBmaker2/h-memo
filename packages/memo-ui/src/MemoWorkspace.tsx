import { type ReactNode } from "react";
import { type Memo } from "@h-memo/memo-core";
import { StickyMemo } from "./StickyMemo";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";

type MemoWorkspaceShellProps = {
  appClassName: string;
  title: string;
  memos: Memo[];
  managedMemos?: Memo[];
  actions?: ReactNode;
  authStatus?: {
    state: "signed-in" | "signed-out" | "unavailable";
    label: string;
    photoUrl?: string;
  };
  onCreateMemo: () => void;
  onOpenMemo?: (memoId: string) => void;
  onMemoChange: (memo: Memo) => void;
  onDeleteMemo: (memoId: string) => void;
  onCloseMemo?: (memoId: string) => void;
  onRequestWindowDrag?: () => void;
  onRequestWindowResize?: (direction: "SouthEast") => void;
  onRequestWindowClose?: () => void;
  onRequestCollapseChange?: (collapsed: boolean) => void;
  settingsProps: SettingsPanelProps;
};

export function MemoWorkspace({
  appClassName,
  title,
  memos,
  managedMemos,
  onCreateMemo,
  onOpenMemo,
  onMemoChange,
  onDeleteMemo,
  onCloseMemo,
  onRequestWindowDrag,
  onRequestWindowResize,
  onRequestWindowClose,
  onRequestCollapseChange,
  settingsProps,
  actions,
  authStatus,
}: MemoWorkspaceShellProps) {
  const hasMemos = memos.length > 0;
  const menuMemos = managedMemos ?? memos;
  const hasManagedMemos = menuMemos.length > 0;
  const getMemoLabel = (memo: Memo, index: number) => {
    const text = memo.plainText.trim().replace(/\s+/g, " ");
    return text || `빈 메모 ${index + 1}`;
  };
  const appMenuContent = (
    <div className="memo-menu__panel-content">
      <section className="memo-menu__group" aria-label="메모 기능">
        <h3 className="memo-menu__group-title">메모 기능</h3>
        <button type="button" onClick={onCreateMemo}>
          새 메모
        </button>
        {actions}
      </section>
      <section className="memo-menu__group" aria-label="메모 관리">
        <h3 className="memo-menu__group-title">메모 관리</h3>
        {hasManagedMemos ? (
          <ul className="memo-list">
            {menuMemos.map((memo, index) => (
              <li key={memo.id} className="memo-list__item">
                <span title={memo.plainText}>{getMemoLabel(memo, index)}</span>
                {onOpenMemo ? (
                  <button
                    type="button"
                    aria-label={`${getMemoLabel(memo, index)} 열기`}
                    onClick={() => onOpenMemo(memo.id)}
                  >
                    열기
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`${getMemoLabel(memo, index)} 삭제`}
                  onClick={() => onDeleteMemo(memo.id)}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="memo-list__empty">관리할 메모가 없습니다.</p>
        )}
      </section>
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
        showStartupSection={settingsProps.showStartupSection}
        firebaseConfig={settingsProps.firebaseConfig}
        onBackup={settingsProps.onBackup}
        onRestore={settingsProps.onRestore}
        onExportText={settingsProps.onExportText}
        onExportJsonBackup={settingsProps.onExportJsonBackup}
        onImportJsonBackup={settingsProps.onImportJsonBackup}
        onToggleStartup={settingsProps.onToggleStartup}
        onSignIn={settingsProps.onSignIn}
        onSignOut={settingsProps.onSignOut}
        onSaveFirebaseConfig={settingsProps.onSaveFirebaseConfig}
        onClearFirebaseConfig={settingsProps.onClearFirebaseConfig}
      />
    </div>
  );

  return (
    <main className={appClassName}>
      <header className={`${appClassName}__chrome`}>
        <h1 className="visually-hidden">{title}</h1>
        {hasMemos ? null : (
          <details className="workspace-menu">
            <summary aria-label="앱 메뉴" title="앱 메뉴">...</summary>
            <div className="workspace-menu__panel">{appMenuContent}</div>
          </details>
        )}
      </header>

      <section
        className={`${appClassName}__memos ${appClassName}__memos--${
          memos.length > 1 ? "multiple" : "single"
        }`}
        aria-label="메모 목록"
      >
        {hasMemos ? (
          memos.map((memo, index) => (
            <StickyMemo
              key={memo.id}
              memo={memo}
              appMenuContent={index === 0 ? appMenuContent : undefined}
              authStatus={authStatus}
              onChange={onMemoChange}
              onDelete={onDeleteMemo}
              onCloseMemo={onCloseMemo}
              onRequestWindowDrag={onRequestWindowDrag}
              onRequestWindowResize={onRequestWindowResize}
              onRequestWindowClose={onRequestWindowClose}
              onRequestCollapseChange={onRequestCollapseChange}
            />
          ))
        ) : (
          <div className={`${appClassName}__empty`}>
            <p>메모가 없습니다. 상단의 메뉴에서 새 메모를 만들어 보세요.</p>
          </div>
        )}
      </section>
    </main>
  );
}
