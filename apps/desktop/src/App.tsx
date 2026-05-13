import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MemoryMemoRepository,
  createMemo,
  formatMemosAsCombinedText,
  updateMemoWindowState,
  type Memo,
  type MemoRepository,
} from "@h-memo/memo-core";
import { SettingsPanel, StickyMemo } from "@h-memo/memo-ui";
import { TauriMemoRepository } from "./adapters/tauriMemoRepository";
import {
  exportTextFile,
  type ExportTextFileResult,
  getStartupEnabled,
  setStartupEnabled as setTauriStartupEnabled,
} from "./adapters/tauriPlatform";

type BackupMessage = string;

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function createRepository(isTauri: boolean): MemoRepository {
  return isTauri ? new TauriMemoRepository() : new MemoryMemoRepository();
}

function createMemoId(): string {
  return `memo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const isTauri = isTauriRuntime();
  const repository = useMemo(() => createRepository(isTauri), [isTauri]);
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

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isMounted = true;
    const loadStartup = async () => {
      try {
        const enabled = await getStartupEnabled();
        if (!isMounted) {
          return;
        }
        setStartupEnabled(enabled);
      } catch {
        if (!isMounted) {
          return;
        }
        setStartupEnabled(false);
        setBackupStatus("시작프로그램 상태를 확인하지 못했습니다.");
      }
    };

    void loadStartup();

    return () => {
      isMounted = false;
    };
  }, [isTauri]);

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
    persistMemo(nextMemo);
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

  const handleGenerateTextPreview = async () => {
    const contents = formatMemosAsCombinedText(memos);
    setTxtPreview(contents);

    if (!isTauri) {
      return;
    }

    const result: ExportTextFileResult = await exportTextFile("h-memo-backup.txt", contents);

    if (result.status === "saved") {
      setBackupStatus(`TXT 저장 완료: ${result.path}`);
    } else if (result.status === "cancelled") {
      setBackupStatus("TXT 저장을 취소했습니다.");
    } else {
      setBackupStatus(`TXT 저장 실패: ${result.message}`);
    }
  };

  const handleBackup = () => {
    setBackupStatus(`백업 예정: ${new Date().toLocaleString()}`);
  };

  const handleRestore = () => {
    setBackupStatus(`복원 완료: ${new Date().toLocaleString()}`);
  };

  const handleToggleStartup = async (enabled: boolean) => {
    if (!isTauri) {
      setStartupEnabled(enabled);
      return;
    }

    const previousEnabled = startupEnabled;

    try {
      const nextEnabled = await setTauriStartupEnabled(enabled);
      setStartupEnabled(nextEnabled);
      if (nextEnabled !== enabled) {
        setBackupStatus("시작프로그램 설정을 변경하지 못했습니다.");
      }
    } catch {
      setStartupEnabled(previousEnabled);
      setBackupStatus("시작프로그램 설정을 변경하지 못했습니다.");
    }
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
