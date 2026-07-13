import { useState, type ReactNode } from "react";
import { type Memo } from "@h-memo/memo-core";
import { StickyMemo } from "./StickyMemo";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";

const UPDATE_HISTORY = [
  {
    date: "2026-05-13",
    title: "개발 시작",
    detail: "메모 작성, 로컬 저장, 데스크톱 창 작업을 시작했습니다.",
  },
  {
    date: "2026-07-11",
    title: "데이터 안전성 하드닝",
    detail: "서버 백업 세대, 복원 안전 잠금, 메뉴 접근성을 보강했습니다.",
  },
  {
    date: "2026-07-13",
    title: "자동 버전 및 릴리스",
    detail:
      "검증을 통과한 main 변경은 앱 패키지와 데스크톱 배포 버전을 patch 단위로 함께 올려 다음 릴리스를 준비하도록 개선했습니다.",
  },
  {
    date: "2026-07-13",
    title: "KST 날짜 표시 안정화",
    detail:
      "실행 PC와 CI의 시간대가 달라도 날짜와 시각을 대한민국 표준시(Asia/Seoul)로 일관되게 표시하도록 개선했습니다.",
  },
  {
    date: "2026-07-13",
    title: "최종 호환성 보강",
    detail:
      "legacy 백업, memo ID codec, 창 예약 복구, 삭제 재조정을 보강했습니다. Node/환경이 달라도 한국어 오전·오후 표기가 일관되게 보이도록 보강했습니다.",
  },
  {
    date: "2026-07-13",
    title: "KST 일별 백업 보존",
    detail:
      "대한민국 날짜별 최신 백업 1개를 최근 365일 동안 보관하고, 선택한 날짜의 메모만 불러오도록 개선했습니다.",
  },
] as const;

type MemoWorkspaceShellProps = {
  appClassName: string;
  title: string;
  appVersion?: string;
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
  onRequestSync?: () => void;
  isSyncDisabled?: boolean;
  isSyncBusy?: boolean;
  isMemoEditingDisabled?: boolean;
  settingsProps: SettingsPanelProps;
};

export function MemoWorkspace({
  appClassName,
  title,
  appVersion,
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
  onRequestSync,
  isSyncDisabled,
  isSyncBusy,
  isMemoEditingDisabled = false,
  settingsProps,
  actions,
  authStatus,
}: MemoWorkspaceShellProps) {
  const [isUpdateHistoryOpen, setIsUpdateHistoryOpen] = useState(false);
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
        <h2 className="memo-menu__group-title">메모 기능</h2>
        <button type="button" onClick={onCreateMemo} disabled={isMemoEditingDisabled}>
          새 메모
        </button>
        {actions}
      </section>
      <section className="memo-menu__group" aria-label="메모 관리">
        <h2 className="memo-menu__group-title">메모 관리</h2>
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
                  disabled={isMemoEditingDisabled}
                  >
                    열기
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`${getMemoLabel(memo, index)} 삭제`}
                  className="memo-menu__action--destructive destructive-action"
                  onClick={() => onDeleteMemo(memo.id)}
                  disabled={isMemoEditingDisabled}
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
      <button
        type="button"
        className="memo-menu__updates-button"
        aria-expanded={isUpdateHistoryOpen}
        onClick={() => setIsUpdateHistoryOpen((isOpen) => !isOpen)}
      >
        {isUpdateHistoryOpen ? "업데이트 내역 닫기" : "업데이트 내역"}
      </button>
      {isUpdateHistoryOpen ? (
        <section className="memo-menu__updates" aria-label="업데이트 내역">
          <h2 className="memo-menu__updates-title">업데이트 내역</h2>
          <ul className="memo-menu__updates-list">
            {UPDATE_HISTORY.map((entry) => (
              <li key={`${entry.date}-${entry.title}`}>
                <time dateTime={entry.date}>{entry.date}</time>
                <strong>{entry.title}</strong>
                <span>{entry.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <SettingsPanel
        userName={settingsProps.userName}
        backupStatus={settingsProps.backupStatus}
        startupEnabled={settingsProps.startupEnabled}
        isStartupAvailable={settingsProps.isStartupAvailable}
        isServerAvailable={settingsProps.isServerAvailable}
        isServerBusy={settingsProps.isServerBusy}
        isLocalRestoreDisabled={settingsProps.isLocalRestoreDisabled}
        isBackupDisabled={settingsProps.isBackupDisabled}
        isRestoreDisabled={settingsProps.isRestoreDisabled}
        canUndoRestore={settingsProps.canUndoRestore}
        onUndoRestore={settingsProps.onUndoRestore}
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
              appVersion={appVersion}
              appMenuContent={index === 0 ? appMenuContent : undefined}
              authStatus={authStatus}
              onChange={onMemoChange}
              onDelete={onDeleteMemo}
              onCloseMemo={onCloseMemo}
              onRequestWindowDrag={onRequestWindowDrag}
              onRequestWindowResize={onRequestWindowResize}
              onRequestWindowClose={onRequestWindowClose}
              onRequestCollapseChange={onRequestCollapseChange}
              onRequestSync={onRequestSync}
              isSyncDisabled={isSyncDisabled}
              isSyncBusy={isSyncBusy}
              isEditingDisabled={isMemoEditingDisabled}
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
