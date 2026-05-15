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
  onMemoChange: (memo: Memo) => void;
  onDeleteMemo: (memoId: string) => void;
  onRequestWindowDrag?: () => void;
  onRequestWindowResize?: (direction: "SouthEast") => void;
  onRequestWindowMinimize?: () => void;
  onRequestWindowMaximize?: () => void;
  onRequestWindowClose?: () => void;
  onRequestCollapseChange?: (collapsed: boolean) => void;
  settingsProps: SettingsPanelProps;
};

export function MemoWorkspace({
  appClassName,
  title,
  memos,
  txtPreview,
  onCreateMemo,
  onMemoChange,
  onDeleteMemo,
  onRequestWindowDrag,
  onRequestWindowResize,
  onRequestWindowMinimize,
  onRequestWindowMaximize,
  onRequestWindowClose,
  onRequestCollapseChange,
  settingsProps,
  actions,
}: MemoWorkspaceShellProps) {
  const hasMemos = memos.length > 0;
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
        {hasMemos ? (
          <ul className="memo-list">
            {memos.map((memo, index) => (
              <li key={memo.id} className="memo-list__item">
                <span title={memo.plainText}>{getMemoLabel(memo, index)}</span>
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
      <section className="memo-menu__group" aria-label="TXT 내용">
        <h3 className="memo-menu__group-title">TXT 내용</h3>
        <pre aria-label="TXT 내용 결과" className={`${appClassName}__preview`}>
          {txtPreview}
        </pre>
      </section>
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
              onChange={onMemoChange}
              onDelete={onDeleteMemo}
              onRequestWindowDrag={onRequestWindowDrag}
              onRequestWindowResize={onRequestWindowResize}
              onRequestWindowMinimize={onRequestWindowMinimize}
              onRequestWindowMaximize={onRequestWindowMaximize}
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
