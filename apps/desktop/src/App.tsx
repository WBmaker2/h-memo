import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFirestore, type Firestore } from "firebase/firestore";
import { Auth } from "firebase/auth";
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
import {
  FirestoreBackupGateway,
  backupMemos,
  createFirebaseApp,
  getFirebaseAuth,
  hasFirebaseConfig,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  type HMemoUser,
} from "@h-memo/memo-sync";
import { getFirebaseClientEnv } from "./env/firebaseEnv";

type BackupMessage = string;
type SyncServices = {
  auth: Auth;
  firestore: Firestore;
  gateway: FirestoreBackupGateway;
};

const FIREBASE_UNAVAILABLE_MESSAGE = "Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 로그인 후 사용 가능합니다.";
const FIREBASE_INIT_FAILED_PREFIX = "서버 백업 초기화 실패:";
const AUTH_LOGIN_FAILED_PREFIX = "Google 로그인 실패:";
const BACKUP_FAILED_PREFIX = "백업 실패:";
const RESTORE_FAILED_PREFIX = "복원 실패:";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function createRepository(isTauri: boolean): MemoRepository {
  return isTauri ? new TauriMemoRepository() : new MemoryMemoRepository();
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

export function App() {
  const isTauri = isTauriRuntime();
  const repository = useMemo(() => createRepository(isTauri), [isTauri]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [txtPreview, setTxtPreview] = useState("");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [syncServicesInitialized, setSyncServicesInitialized] = useState(false);
  const firebaseClientEnv = useMemo(() => getFirebaseClientEnv(), []);
  const hasFirebaseConfigSet = useMemo(() => hasFirebaseConfig(firebaseClientEnv), [firebaseClientEnv]);
  const [backupStatus, setBackupStatus] = useState<BackupMessage>(
    hasFirebaseConfigSet ? "백업 정보 없음" : FIREBASE_UNAVAILABLE_MESSAGE
  );
  const [user, setUser] = useState<HMemoUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [servicesAvailable, setServicesAvailable] = useState(hasFirebaseConfigSet);

  const syncServicesRef = useRef<SyncServices | null>(null);

  const reloadMemos = useCallback(async () => {
    const all = await repository.listMemos();
    setMemos(all);
  }, [repository]);

  useEffect(() => {
    void reloadMemos();
  }, [reloadMemos]);

  const ensureSyncServices = useCallback((): SyncServices | null => {
    if (!hasFirebaseConfigSet) {
      return null;
    }

    if (syncServicesRef.current) {
      return syncServicesRef.current;
    }

    try {
      const app = createFirebaseApp(firebaseClientEnv);
      const auth = getFirebaseAuth(app);
      const firestore = getFirestore(app);
      const services: SyncServices = {
        auth,
        firestore,
        gateway: new FirestoreBackupGateway(firestore),
      };
      syncServicesRef.current = services;
      setSyncServicesInitialized(true);
      setServicesAvailable(true);
      return services;
    } catch (error) {
      syncServicesRef.current = null;
      setSyncServicesInitialized(false);
      setServicesAvailable(false);
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} ${getErrorMessage(error)}`);
      return null;
    }
  }, [firebaseClientEnv, hasFirebaseConfigSet]);

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

      return sortMemos(nextMemos);
    });
  };

  const persistMemo = async (nextMemo: Memo) => {
    const saved = await repository.saveMemo(nextMemo);
    upsertMemo(saved);
  };

  const replaceMemosFromBackup = async (nextMemos: Memo[]) => {
    const currentMemos = await repository.listMemos();
    const keptIds = new Set(nextMemos.map((memo) => memo.id));
    const removedAt = new Date().toISOString();

    const removePromises = currentMemos
      .filter((memo) => !keptIds.has(memo.id))
      .map((memo) => repository.softDeleteMemo(memo.id, removedAt).catch(() => {}));
    const savePromises = nextMemos.map((memo) => repository.saveMemo(memo));

    await Promise.all(removePromises);
    await Promise.all(savePromises);
    setMemos(sortMemos(nextMemos));
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

  const handleSignIn = async () => {
    if (!servicesAvailable) {
      setBackupStatus(FIREBASE_UNAVAILABLE_MESSAGE);
      return;
    }
    if (isBusy) {
      return;
    }

    const services = ensureSyncServices();
    if (!services) {
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} 인증 설정이 올바르지 않습니다.`);
      return;
    }

    setIsBusy(true);
    setBackupStatus("Google 로그인 중...");
    try {
      const nextUser = await signInWithGoogle(services.auth);
      setUser(nextUser);
      setBackupStatus(`${nextUser.displayName || nextUser.email || "사용자"}님이 로그인했습니다.`);
    } catch (error) {
      setBackupStatus(`${AUTH_LOGIN_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignOut = async () => {
    const services = ensureSyncServices();
    if (!services) {
      setUser(null);
      setBackupStatus("로그아웃했습니다.");
      return;
    }

    setIsBusy(true);
    try {
      await signOutUser(services.auth);
      setUser(null);
      setBackupStatus("로그아웃했습니다.");
    } catch (error) {
      setBackupStatus(`로그아웃 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleBackup = async () => {
    const services = ensureSyncServices();
    if (!user) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return;
    }

    if (!services || !servicesAvailable) {
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} 구성 값을 확인해 주세요.`);
      return;
    }

    if (isBusy) {
      return;
    }

    setIsBusy(true);
    setBackupStatus("백업을 시작합니다.");
    try {
      const result = await backupMemos(services.gateway, user.uid, memos);
      setBackupStatus(`백업 완료: ${result.path}`);
    } catch (error) {
      setBackupStatus(`${BACKUP_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestore = async () => {
    const services = ensureSyncServices();
    if (!user) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return;
    }

    if (!services || !servicesAvailable) {
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} 구성 값을 확인해 주세요.`);
      return;
    }

    if (isBusy) {
      return;
    }

    setIsBusy(true);
    setBackupStatus("복원을 시작합니다.");
    try {
      const payload = await restoreLatestBackup(services.gateway, user.uid);

      if (!payload) {
        setBackupStatus("복원할 백업이 없습니다.");
        return;
      }

      await replaceMemosFromBackup(payload.memos);
      setBackupStatus(`복원 완료: ${payload.memos.length}개 메모`);
    } catch (error) {
      setBackupStatus(`${RESTORE_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
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

  const isServerReady = hasFirebaseConfigSet && servicesAvailable;
  const isBackupDisabled = !isServerReady || user === null || isBusy || !syncServicesInitialized;
  const isRestoreDisabled = !isServerReady || user === null || isBusy || !syncServicesInitialized;
  const isAuthDisabled = !isServerReady || isBusy;

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
        userName={user ? user.displayName || user.email || "로그인 필요" : null}
        backupStatus={backupStatus}
        startupEnabled={startupEnabled}
        onBackup={handleBackup}
        onRestore={handleRestore}
        onExportText={handleGenerateTextPreview}
        onToggleStartup={handleToggleStartup}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        isServerAvailable={servicesAvailable}
        isServerBusy={isBusy}
        isBackupDisabled={isBackupDisabled}
        isRestoreDisabled={isRestoreDisabled}
        isAuthDisabled={isAuthDisabled}
      />
    </main>
  );
}
