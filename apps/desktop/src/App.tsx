import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MemoryMemoRepository,
  createMemo,
  formatMemosAsCombinedText,
  updateMemoWindowState,
  type Memo,
} from "@h-memo/memo-core";
import { SettingsPanel, StickyMemo } from "@h-memo/memo-ui";

type BackupMessage = string;

function createMemoId(): string {
  return `memo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const repository = useMemo(() => new MemoryMemoRepository(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [txtPreview, setTxtPreview] = useState("");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupMessage>("백업 정보 없음");

  const reloadMemos = useCallback(async () => {
    const all = await repository.listMemos();
    setMemos(all);
  }, [repository]);

  useEffect(() => {
    void reloadMemos();
  }, [reloadMemos]);

  const visibleMemos = useMemo(
    () => memos.filter((memo) => memo.deletedAt === null && memo.windowState.visible),
    [memos]
  );

  const upsertMemo = (nextMemo: Memo) => {
    setMemos((previousMemos) => {
      const nextMemos = previousMemos.some((memo) => memo.id === nextMemo.id)
        ? previousMemos.map((memo) => (memo.id === nextMemo.id ? nextMemo : memo))
        : [...previousMemos, nextMemo];

      return nextMemos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  };

  const persistMemo = async (nextMemo: Memo) => {
    const saved = await repository.saveMemo(nextMemo);
    upsertMemo(saved);
  };

  const handleCreateMemo = async () => {
    const now = new Date().toISOString();
    const nextMemo = createMemo({
      id: createMemoId(),
      now,
      title: "",
    });

    await persistMemo(nextMemo);
  };

  const handleMemoChange = (nextMemo: Memo) => {
    void persistMemo(nextMemo);
  };

  const handleHideMemo = async (memoId: string) => {
    const target = memos.find((memo) => memo.id === memoId);
    if (!target) {
      return;
    }

    const hidden = updateMemoWindowState(target, { visible: false }, new Date().toISOString());
    await persistMemo(hidden);
  };

  const handleDeleteMemo = async (memoId: string) => {
    const target = memos.find((memo) => memo.id === memoId);
    if (!target) {
      return;
    }

    const deletedAt = new Date().toISOString();
    const deleted = await repository.softDeleteMemo(memoId, deletedAt);
    upsertMemo(deleted);
  };

  const handleGenerateTextPreview = () => {
    setTxtPreview(formatMemosAsCombinedText(visibleMemos));
  };

  const handleBackup = () => {
    setBackupStatus(`백업 예정: ${new Date().toLocaleString()}`);
  };

  const handleRestore = () => {
    setBackupStatus(`복원 완료: ${new Date().toLocaleString()}`);
  };

  const handleToggleStartup = (enabled: boolean) => {
    setStartupEnabled(enabled);
  };

  return (
    <main className="desktop-app">
      <header className="desktop-app__header">
        <h1>H Memo</h1>
      </header>

      <section className="desktop-app__actions">
        <button type="button" onClick={handleCreateMemo}>
          새 메모
        </button>
        <button type="button" onClick={handleGenerateTextPreview}>
          TXT 미리보기
        </button>
      </section>

      <section className="desktop-app__memos">
        {visibleMemos.map((memo) => (
          <StickyMemo
            key={memo.id}
            memo={memo}
            onChange={handleMemoChange}
            onHide={handleHideMemo}
            onDelete={handleDeleteMemo}
          />
        ))}
      </section>

      <pre aria-label="TXT 미리보기 결과" className="desktop-app__preview">
        {txtPreview}
      </pre>

      <SettingsPanel
        userName={null}
        backupStatus={backupStatus}
        startupEnabled={startupEnabled}
        onBackup={handleBackup}
        onRestore={handleRestore}
        onExportText={handleGenerateTextPreview}
        onToggleStartup={handleToggleStartup}
        onSignIn={() => {
          setBackupStatus("로그인 필요 없음");
        }}
        onSignOut={() => {
          setBackupStatus("로그아웃 완료");
        }}
      />
    </main>
  );
}
