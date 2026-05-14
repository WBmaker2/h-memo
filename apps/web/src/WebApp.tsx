import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import {
  createMemo,
  formatMemosAsCombinedText,
  updateMemoWindowState,
  type Memo,
  type MemoRepository,
} from "@h-memo/memo-core";
import { MemoWorkspace } from "@h-memo/memo-ui";
import {
  FirestoreBackupGateway,
  backupMemos,
  createFirebaseApp,
  getFirebaseAuth,
  hasFirebaseConfig,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
  type HMemoUser,
} from "@h-memo/memo-sync";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { LocalStorageMemoRepository } from "./adapters/localStorageMemoRepository";

const FIREBASE_UNAVAILABLE_MESSAGE = "Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 로그인 후 사용 가능합니다.";
const STARTUP_UNAVAILABLE_MESSAGE = "웹에서는 시작프로그램 등록을 사용할 수 없습니다.";
const BROWSER_BACKUP_READY_MESSAGE = "백업 정보 없음";
const FIREBASE_INIT_FAILED_PREFIX = "서버 백업 초기화 실패:";
const AUTH_SUBSCRIBE_FAILED_PREFIX = "인증 상태 복구 실패:";
const AUTH_LOGIN_FAILED_PREFIX = "Google 로그인 실패:";
const BACKUP_FAILED_PREFIX = "백업 실패:";
const RESTORE_FAILED_PREFIX = "복원 실패:";
const NO_BACKUP_MESSAGE = "복원할 백업이 없습니다.";

type BackupMessage = string;
type SyncServices = {
  auth: Auth;
  firestore: Firestore;
  gateway: FirestoreBackupGateway;
};

type WebPreviewUser = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
};

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

function normalizePreviewUser(user: HMemoUser | null): WebPreviewUser | null {
  if (!user) {
    return null;
  }

  return {
    uid: user.uid,
    displayName: user.displayName || null,
    email: user.email || null,
  };
}

function sortMemos(nextMemos: Memo[]): Memo[] {
  return [...nextMemos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function WebApp() {
  const repository = useMemo<MemoRepository>(() => createRepository(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [txtPreview, setTxtPreview] = useState("");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupMessage>(BROWSER_BACKUP_READY_MESSAGE);
  const [user, setUser] = useState<WebPreviewUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [syncServicesInitialized, setSyncServicesInitialized] = useState(false);

  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistErrorRef = useRef<unknown | null>(null);
  const syncServicesRef = useRef<SyncServices | null>(null);

  const firebaseClientEnv = useMemo(() => getFirebaseClientEnv(), []);
  const hasFirebaseConfigSet = useMemo(
    () => hasFirebaseConfig(firebaseClientEnv),
    [firebaseClientEnv]
  );
  const [servicesAvailableState, setServicesAvailableState] = useState(hasFirebaseConfigSet);
  const isServerReady = servicesAvailableState && syncServicesInitialized;

  const reloadMemos = useCallback(async () => {
    const all = await repository.listMemos();
    setMemos(sortMemos(all));
  }, [repository]);

  useEffect(() => {
    setBackupStatus(
      hasFirebaseConfigSet ? BROWSER_BACKUP_READY_MESSAGE : FIREBASE_UNAVAILABLE_MESSAGE
    );
    setServicesAvailableState(hasFirebaseConfigSet);
    void reloadMemos();
  }, [hasFirebaseConfigSet, reloadMemos]);

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
      setServicesAvailableState(true);
      return services;
    } catch (error) {
      syncServicesRef.current = null;
      setSyncServicesInitialized(false);
      setServicesAvailableState(false);
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} ${getErrorMessage(error)}`);
      return null;
    }
  }, [firebaseClientEnv, hasFirebaseConfigSet]);

  useEffect(() => {
    if (!hasFirebaseConfigSet) {
      return;
    }

    const services = ensureSyncServices();
    if (!services) {
      return;
    }

    let isMounted = true;
    try {
      const unsubscribe = subscribeAuthUser(services.auth, (nextUser) => {
        if (!isMounted) {
          return;
        }

        if (nextUser) {
          setUser(normalizePreviewUser(nextUser));
          setBackupStatus(
            `${nextUser.displayName || nextUser.email || "사용자"}님이 로그인했습니다.`
          );
        } else {
          setUser(null);
          setBackupStatus(LOGIN_REQUIRED_MESSAGE);
        }
      });

      return () => {
        isMounted = false;
        unsubscribe();
      };
    } catch (error) {
      setBackupStatus(`${AUTH_SUBSCRIBE_FAILED_PREFIX} ${getErrorMessage(error)}`);
      return;
    }
  }, [ensureSyncServices, hasFirebaseConfigSet]);

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

  const waitForPendingPersists = async () => {
    await persistQueueRef.current;
    if (persistErrorRef.current) {
      throw persistErrorRef.current;
    }
  };

  const persistMemo = (nextMemo: Memo, options?: { skipStateUpdate: boolean }) => {
    return enqueuePersist(async () => {
      const saved = await repository.saveMemo(nextMemo);
      if (!options?.skipStateUpdate) {
        upsertMemo(saved);
      }
    });
  };

  const rollbackRestoreAttempt = async (currentMemos: Memo[], nextMemos: Memo[]) => {
    const currentIds = new Set(currentMemos.map((memo) => memo.id));
    const rollbackAt = new Date().toISOString();

    await Promise.allSettled(
      nextMemos
        .filter((memo) => !currentIds.has(memo.id))
        .map((memo) => repository.softDeleteMemo(memo.id, rollbackAt))
    );
    await Promise.allSettled(currentMemos.map((memo) => repository.saveMemo(memo)));
  };

  const replaceMemosFromBackup = async (nextMemos: Memo[]) => {
    const currentMemos = await repository.listMemos();
    const keptIds = new Set(nextMemos.map((memo) => memo.id));
    const removedAt = new Date().toISOString();

    try {
      for (const memo of nextMemos) {
        await repository.saveMemo(memo);
      }
      for (const memo of currentMemos) {
        if (!keptIds.has(memo.id)) {
          await repository.softDeleteMemo(memo.id, removedAt);
        }
      }
    } catch (error) {
      await rollbackRestoreAttempt(currentMemos, nextMemos);
      throw error;
    }

    setMemos(sortMemos(nextMemos));
  };

  const handleCreateMemo = async () => {
    const now = new Date().toISOString();
    const nextMemo = createMemo({
      id: createMemoId(),
      now,
      title: "",
    });

    try {
      await persistMemo(nextMemo);
    } catch (error) {
      setBackupStatus(`메모 저장 실패: ${getErrorMessage(error)}`);
    }
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
    try {
      await persistMemo(hidden);
    } catch (error) {
      setBackupStatus(`메모 숨기기 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleDeleteMemo = async (memoId: string) => {
    const target = memos.find((memo) => memo.id === memoId);
    if (!target) {
      return;
    }

    try {
      const deletedAt = new Date().toISOString();
      const deleted = await repository.softDeleteMemo(memoId, deletedAt);
      upsertMemo(deleted);
    } catch (error) {
      setBackupStatus(`메모 삭제 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleGenerateTextPreview = async () => {
    const contents = formatMemosAsCombinedText(memos);
    setTxtPreview(contents);
    setBackupStatus(contents === "" ? "미리보기할 메모가 없습니다." : "TXT 미리보기 완료");
  };

  const handleSignIn = async () => {
    if (!isServerReady) {
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
      setUser(normalizePreviewUser(nextUser));
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
    if (!user || !services) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return;
    }

    if (!isServerReady) {
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} 구성 값을 확인해 주세요.`);
      return;
    }

    if (isBusy) {
      return;
    }

    setIsBusy(true);
    setBackupStatus("백업을 시작합니다.");
    try {
      await waitForPendingPersists();
      const persistedMemos = await repository.listMemos();
      const result = await backupMemos(services.gateway, user.uid, persistedMemos);
      setBackupStatus(`백업 완료: ${result.path}`);
    } catch (error) {
      setBackupStatus(`${BACKUP_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestore = async () => {
    const services = ensureSyncServices();
    if (!user || !services) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return;
    }

    if (!isServerReady) {
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} 구성 값을 확인해 주세요.`);
      return;
    }

    if (isBusy) {
      return;
    }

    setIsBusy(true);
    setBackupStatus("복원을 시작합니다.");
    try {
      await waitForPendingPersists();
      const payload = await restoreLatestBackup(services.gateway, user.uid);
      if (!payload) {
        setBackupStatus(NO_BACKUP_MESSAGE);
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
    setStartupEnabled(enabled);
    setBackupStatus(STARTUP_UNAVAILABLE_MESSAGE);
  };

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
