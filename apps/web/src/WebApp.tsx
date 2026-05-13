import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createMemo,
  formatMemosAsCombinedText,
  updateMemoWindowState,
  type Memo,
  type MemoRepository,
} from "@h-memo/memo-core";
import { MemoWorkspace } from "@h-memo/memo-ui";
import { hasFirebaseConfig, type HMemoUser } from "@h-memo/memo-sync";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { LocalStorageMemoRepository } from "./adapters/localStorageMemoRepository";

const FIREBASE_UNAVAILABLE_MESSAGE = "Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다.";
const BROWSER_PREVIEW_MESSAGE = "브라우저 미리보기에서는 서버 백업/동기화 기능이 비활성입니다.";
const STARTUP_UNAVAILABLE_MESSAGE = "브라우저 미리보기에서는 시작프로그램 등록을 사용할 수 없습니다.";

function createRepository() {
  return new LocalStorageMemoRepository();
}

function createMemoId(): string {
  return `memo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "알 수 없는 오류";
}

function sortMemos(nextMemos: Memo[]): Memo[] {
  return [...nextMemos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function WebApp() {
  const repository = useMemo<MemoRepository>(() => createRepository(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [txtPreview, setTxtPreview] = useState("");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [backupStatus, setBackupStatus] = useState(BROWSER_PREVIEW_MESSAGE);
  const [user, setUser] = useState<HMemoUser | null>(null);
  const [isBusy] = useState(false);

  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistErrorRef = useRef<unknown | null>(null);

  const firebaseClientEnv = useMemo(() => getFirebaseClientEnv(), []);
  const hasFirebaseConfigSet = useMemo(() => hasFirebaseConfig(firebaseClientEnv), [firebaseClientEnv]);
  const [servicesAvailable, setServicesAvailable] = useState(hasFirebaseConfigSet);

  const reloadMemos = useCallback(async () => {
    const all = await repository.listMemos();
    setMemos(sortMemos(all));
  }, [repository]);

  useEffect(() => {
    setBackupStatus(
      hasFirebaseConfigSet
        ? BROWSER_PREVIEW_MESSAGE
        : FIREBASE_UNAVAILABLE_MESSAGE
    );
    setServicesAvailable(hasFirebaseConfigSet);
    void reloadMemos();
  }, [hasFirebaseConfigSet, reloadMemos]);

  const visibleMemos = useMemo(
    () => memos.filter((memo) => memo.deletedAt === null && memo.windowState.visible),
    [memos]
  );

  const upsertMemo = (nextMemo: Memo) => {
    setMemos((previousMemos) => {
      const nextMemos = previousMemos.some((memo) => memo.id === nextMemo.id)
        ? previousMemos.map((memo) => (memo.id === nextMemo.id ? nextMemo : memo))
        : [...previousMemos, nextMemo];

      return sortMemos(nextMemos);
    });
  };

  const enqueuePersist = (operation: () => Promise<void>) => {
    const queued = persistQueueRef.current.then(operation);
    persistQueueRef.current = queued
      .then(() => {
        persistErrorRef.current = null;
      })
      .catch((error) => {
        persistErrorRef.current = error;
      });
    return queued;
  };

  const persistMemo = (nextMemo: Memo, options?: { skipStateUpdate: boolean }) => {
    return enqueuePersist(async () => {
      const saved = await repository.saveMemo(nextMemo);
      if (!options?.skipStateUpdate) {
        upsertMemo(saved);
      }
    });
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
    upsertMemo(nextMemo);
    void persistMemo(nextMemo, { skipStateUpdate: true }).catch((error) => {
      setBackupStatus(`메모 저장 실패: ${getErrorMessage(error)}`);
    });
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
    setBackupStatus(contents === "" ? "미리보기할 메모가 없습니다." : "TXT 미리보기 완료");
  };

  const handleSignIn = async () => {
    setBackupStatus(
      hasFirebaseConfigSet
        ? "브라우저 미리보기에서는 로그인 연동이 제공되지 않습니다."
        : FIREBASE_UNAVAILABLE_MESSAGE
    );
  };

  const handleSignOut = async () => {
    setUser(null);
    setBackupStatus("로그아웃했습니다.");
  };

  const handleBackup = async () => {
    setBackupStatus(BROWSER_PREVIEW_MESSAGE);
  };

  const handleRestore = async () => {
    setBackupStatus(BROWSER_PREVIEW_MESSAGE);
  };

  const handleToggleStartup = async (enabled: boolean) => {
    setStartupEnabled(enabled);
    setBackupStatus(STARTUP_UNAVAILABLE_MESSAGE);
  };

  const isServerReady = hasFirebaseConfigSet && servicesAvailable;
  const isBackupDisabled = !isServerReady || user === null || isBusy;
  const isRestoreDisabled = !isServerReady || user === null || isBusy;
  const isAuthDisabled = !isServerReady || isBusy;

  return (
    <MemoWorkspace
      appClassName="web-app"
      title="H Memo (웹 미리보기)"
      memos={visibleMemos}
      txtPreview={txtPreview}
      onCreateMemo={handleCreateMemo}
      onExportText={handleGenerateTextPreview}
      onMemoChange={handleMemoChange}
      onHideMemo={handleHideMemo}
      onDeleteMemo={handleDeleteMemo}
      settingsProps={{
        userName: user ? user.displayName || user.email || "로그인 필요" : null,
        backupStatus,
        startupEnabled,
        onBackup: handleBackup,
        onRestore: handleRestore,
        onExportText: handleGenerateTextPreview,
        onToggleStartup: handleToggleStartup,
        onSignIn: handleSignIn,
        onSignOut: handleSignOut,
        isServerAvailable: isServerReady,
        isServerBusy: isBusy,
        isBackupDisabled,
        isRestoreDisabled,
        isAuthDisabled,
        isStartupAvailable: false,
      }}
    />
  );
}
