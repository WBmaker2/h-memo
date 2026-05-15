import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFirestore, type Firestore } from "firebase/firestore";
import type { Auth } from "firebase/auth";
import {
  MemoryMemoRepository,
  createBackupPayload,
  createMemo,
  formatMemosAsCombinedText,
  updateMemoWindowState,
  validateLocalBackupPayload,
  type Memo,
  type MemoRepository,
} from "@h-memo/memo-core";
import { MemoWorkspace, type FirebaseConfigFormValue } from "@h-memo/memo-ui";
import { TauriMemoRepository } from "./adapters/tauriMemoRepository";
import {
  exportTextFile,
  exportJsonFile,
  importJsonFile,
  type ExportTextFileResult,
  getStartupEnabled,
  setStartupEnabled as setTauriStartupEnabled,
} from "./adapters/tauriPlatform";
import {
  closeWindow,
  openMemoWindow,
  listenWindowBoundsChanged,
  minimizeWindow,
  readWindowBounds,
  restoreWindowBounds,
  setWindowHeight,
  startWindowDrag,
  startWindowResize,
  toggleMaximizeWindow,
  type WindowBounds,
} from "./adapters/tauriWindow";
import {
  FirestoreBackupGateway,
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  getFirebaseAuth,
  subscribeAuthUser,
  hasFirebaseConfig,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  waitForSignedInUser,
  type HMemoUser,
} from "@h-memo/memo-sync";
import {
  clearStoredFirebaseClientConfig,
  mergeFirebaseClientConfig,
  readStoredFirebaseClientConfig,
  saveStoredFirebaseClientConfig,
  toFirebaseClientConfigInput,
} from "@h-memo/memo-sync/firebase-client-config";
import { validateFirebaseClientEnv } from "@h-memo/memo-sync/firebase-env-validation";
import { getFirebaseClientEnv } from "./env/firebaseEnv";

type BackupMessage = string;
type SyncServices = {
  auth: Auth;
  firestore: Firestore;
  gateway: FirestoreBackupGateway;
};

const FIREBASE_UNAVAILABLE_MESSAGE =
  "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 구글 로그인 후 사용 가능합니다.";
const FIREBASE_INIT_FAILED_PREFIX = "서버 백업 초기화 실패:";
const AUTH_SUBSCRIBE_FAILED_PREFIX = "인증 상태 복구 실패:";
const AUTH_LOGIN_FAILED_PREFIX = "구글 로그인 실패:";
const BACKUP_FAILED_PREFIX = "백업 실패:";
const RESTORE_FAILED_PREFIX = "복원 실패:";
const JSON_RESTORE_CONFIRM_MESSAGE =
  "JSON 백업 파일 내용으로 현재 메모를 대체합니다. 백업에 없는 메모는 삭제됩니다. 계속할까요?";
const COLLAPSED_WINDOW_HEIGHT = 46;
const MIN_EXPANDED_WINDOW_HEIGHT = 160;

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
  const requestedMemoId = useMemo(() => {
    if (!isTauri) {
      return null;
    }
    return new URLSearchParams(window.location.search).get("memoId");
  }, [isTauri]);
  const repository = useMemo(() => createRepository(isTauri), [isTauri]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [activeMemoId, setActiveMemoId] = useState<string | null>(requestedMemoId);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [syncServicesInitialized, setSyncServicesInitialized] = useState(false);
  const buildFirebaseClientEnv = useMemo(() => getFirebaseClientEnv(), []);
  const hasBuildFirebaseConfigSet = useMemo(
    () => hasFirebaseConfig(buildFirebaseClientEnv),
    [buildFirebaseClientEnv]
  );
  const [storedFirebaseClientEnv, setStoredFirebaseClientEnv] = useState(() =>
    readStoredFirebaseClientConfig()
  );
  const allowFirebaseConfigOverride = !hasBuildFirebaseConfigSet;
  const firebaseClientEnv = useMemo(
    () =>
      hasBuildFirebaseConfigSet
        ? buildFirebaseClientEnv
        : mergeFirebaseClientConfig(buildFirebaseClientEnv, storedFirebaseClientEnv),
    [buildFirebaseClientEnv, hasBuildFirebaseConfigSet, storedFirebaseClientEnv]
  );
  const firebaseConfigFormValue = useMemo(
    () => toFirebaseClientConfigInput(firebaseClientEnv),
    [firebaseClientEnv]
  );
  const hasFirebaseConfigSet = useMemo(() => hasFirebaseConfig(firebaseClientEnv), [firebaseClientEnv]);
  const [backupStatus, setBackupStatus] = useState<BackupMessage>(
    hasFirebaseConfigSet ? "백업 정보 없음" : FIREBASE_UNAVAILABLE_MESSAGE
  );
  const [user, setUser] = useState<HMemoUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [servicesAvailable, setServicesAvailable] = useState(hasFirebaseConfigSet);
  const [hasLoadedMemos, setHasLoadedMemos] = useState(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistErrorRef = useRef<unknown | null>(null);
  const memosRef = useRef<Memo[]>([]);
  const restoredMemoIdRef = useRef<string | null>(null);
  const boundsPersistTimerRef = useRef<number | null>(null);
  const expandedWindowBoundsRef = useRef<WindowBounds | null>(null);
  const activeMemoIdRef = useRef<string | null>(requestedMemoId);
  const openedRestoredMemoWindowsRef = useRef(false);

  const syncServicesRef = useRef<SyncServices | null>(null);

  useEffect(() => {
    syncServicesRef.current = null;
    setSyncServicesInitialized(false);
    setServicesAvailable(hasFirebaseConfigSet);
    setUser(null);
  }, [firebaseClientEnv, hasFirebaseConfigSet]);

  const reloadMemos = useCallback(async () => {
    const all = await repository.listMemos();
    memosRef.current = all;
    setMemos(all);
    setHasLoadedMemos(true);
  }, [repository]);

  useEffect(() => {
    void reloadMemos();
  }, [reloadMemos]);

  useEffect(() => {
    memosRef.current = memos;
  }, [memos]);

  useEffect(() => {
    activeMemoIdRef.current = activeMemoId;
  }, [activeMemoId]);

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
          setUser(nextUser);
          setBackupStatus(`${nextUser.displayName || nextUser.email || "사용자"}님이 로그인했습니다.`);
        } else {
          setUser(null);
          setBackupStatus(LOGIN_REQUIRED_MESSAGE);
        }
      });

      void completeGoogleRedirectSignIn(services.auth)
        .then((nextUser) => {
          if (!isMounted || !nextUser) {
            return;
          }
          setUser(nextUser);
          setBackupStatus(`${nextUser.displayName || nextUser.email || "사용자"}님이 로그인했습니다.`);
        })
        .then(async () => {
          const settledUser = await waitForSignedInUser(services.auth, 4000);
          if (!isMounted || !settledUser) {
            return;
          }
          setUser(settledUser);
          setBackupStatus(`${settledUser.displayName || settledUser.email || "사용자"}님이 로그인했습니다.`);
        })
        .catch((error) => {
          if (!isMounted) {
            return;
          }
          setBackupStatus(`${AUTH_LOGIN_FAILED_PREFIX} ${getErrorMessage(error)}`);
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
    () => memos.filter((memo) => memo.deletedAt === null),
    [memos]
  );
  const displayedMemos = useMemo(() => {
    if (!isTauri) {
      return visibleMemos;
    }
    if (!activeMemoId) {
      return [];
    }
    return visibleMemos.filter((memo) => memo.id === activeMemoId);
  }, [activeMemoId, isTauri, visibleMemos]);

  useEffect(() => {
    if (!isTauri || !hasLoadedMemos) {
      return;
    }

    if (activeMemoId && visibleMemos.some((memo) => memo.id === activeMemoId)) {
      return;
    }

    setActiveMemoId(visibleMemos[0]?.id ?? null);
  }, [activeMemoId, hasLoadedMemos, isTauri, visibleMemos]);

  useEffect(() => {
    if (!isTauri || requestedMemoId || !hasLoadedMemos || openedRestoredMemoWindowsRef.current) {
      return;
    }

    const currentMemoId = activeMemoId ?? visibleMemos[0]?.id;
    if (!currentMemoId) {
      return;
    }

    openedRestoredMemoWindowsRef.current = true;
    for (const memo of visibleMemos) {
      if (memo.id === currentMemoId) {
        continue;
      }
      void openMemoWindow(memo).catch((error) => {
        setBackupStatus(`메모 창 열기 실패: ${getErrorMessage(error)}`);
      });
    }
  }, [activeMemoId, hasLoadedMemos, isTauri, requestedMemoId, visibleMemos]);

  const upsertMemo = (nextMemo: Memo) => {
    setMemos((previousMemos) => {
      const nextMemos = previousMemos.some((memo) => memo.id === nextMemo.id)
        ? previousMemos.map((memo) => (memo.id === nextMemo.id ? nextMemo : memo))
        : [...previousMemos, nextMemo];

      const sortedMemos = sortMemos(nextMemos);
      memosRef.current = sortedMemos;
      return sortedMemos;
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

  const persistActiveMemoWindowBounds = useCallback(
    async (boundsOverride?: WindowBounds) => {
      if (!isTauri) {
        return;
      }

      const targetMemoId = activeMemoIdRef.current;
      const target = memosRef.current.find(
        (memo) => memo.deletedAt === null && memo.id === targetMemoId
      );
      if (!target) {
        return;
      }

      const bounds = boundsOverride ?? (await readWindowBounds());
      const windowState = {
        x: bounds.x,
        y: bounds.y,
        ...(bounds.height >= MIN_EXPANDED_WINDOW_HEIGHT
          ? { width: bounds.width, height: bounds.height }
          : {}),
      };
      const nextMemo = updateMemoWindowState(target, windowState, new Date().toISOString());

      upsertMemo(nextMemo);
      await persistMemo(nextMemo, { skipStateUpdate: true });
    },
    [isTauri]
  );

  const scheduleWindowBoundsPersist = useCallback(() => {
    if (!isTauri) {
      return;
    }

    if (boundsPersistTimerRef.current) {
      window.clearTimeout(boundsPersistTimerRef.current);
    }

    boundsPersistTimerRef.current = window.setTimeout(() => {
      boundsPersistTimerRef.current = null;
      void persistActiveMemoWindowBounds().catch((error) => {
        setBackupStatus(`창 위치 저장 실패: ${getErrorMessage(error)}`);
      });
    }, 250);
  }, [isTauri, persistActiveMemoWindowBounds]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isMounted = true;
    let cleanup: (() => void) | null = null;

    void listenWindowBoundsChanged(() => {
      scheduleWindowBoundsPersist();
    })
      .then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        setBackupStatus(`창 위치 감시 실패: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
      cleanup?.();
      if (boundsPersistTimerRef.current) {
        window.clearTimeout(boundsPersistTimerRef.current);
        boundsPersistTimerRef.current = null;
      }
    };
  }, [isTauri, scheduleWindowBoundsPersist]);

  useEffect(() => {
    if (!isTauri || !hasLoadedMemos || visibleMemos.length === 0) {
      return;
    }

    const activeMemo = displayedMemos[0];
    if (!activeMemo) {
      return;
    }

    if (restoredMemoIdRef.current === activeMemo.id) {
      return;
    }

    restoredMemoIdRef.current = activeMemo.id;
    const bounds = activeMemo.windowState;

    void restoreWindowBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }).catch((error) => {
      setBackupStatus(`창 위치 복원 실패: ${getErrorMessage(error)}`);
    });
  }, [displayedMemos, hasLoadedMemos, isTauri, visibleMemos]);

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

    const sortedMemos = sortMemos(nextMemos);
    memosRef.current = sortedMemos;
    setMemos(sortedMemos);
  };

  const handleCreateMemo = async () => {
    const now = new Date().toISOString();
    const nextMemo = createMemo({
      id: createMemoId(),
      now,
      title: "",
    });

    await persistMemo(nextMemo);
    if (!isTauri) {
      return;
    }
    if (!activeMemoIdRef.current) {
      setActiveMemoId(nextMemo.id);
      return;
    }
    await openMemoWindow(nextMemo);
  };

  const handleOpenMemo = async (memoId: string) => {
    const target = memos.find((memo) => memo.id === memoId && memo.deletedAt === null);
    if (!target || !isTauri) {
      return;
    }
    if (target.id === activeMemoIdRef.current) {
      return;
    }
    await openMemoWindow(target);
  };

  const handleMemoChange = (nextMemo: Memo) => {
    upsertMemo(nextMemo);
    void persistMemo(nextMemo, { skipStateUpdate: true }).catch((error) => {
      setBackupStatus(`메모 저장 실패: ${getErrorMessage(error)}`);
    });
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

    if (contents === "") {
      setBackupStatus("내보낼 메모가 없습니다.");
      return;
    }

    if (!isTauri) {
      const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "h-memo-backup.txt";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setBackupStatus("TXT 백업 파일을 만들었습니다.");
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

  const createLocalBackupJson = async () => {
    await waitForPendingPersists();
    const persistedMemos = await repository.listMemos();
    const payload = createBackupPayload({
      userId: user?.uid ?? "local",
      memos: persistedMemos,
      createdAt: new Date().toISOString(),
    });
    return JSON.stringify(payload, null, 2);
  };

  const restoreLocalBackupJson = async (contents: string) => {
    const parsed = validateLocalBackupPayload(JSON.parse(contents));
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    if (!window.confirm(JSON_RESTORE_CONFIRM_MESSAGE)) {
      setBackupStatus("JSON 복원을 취소했습니다.");
      return;
    }

    await replaceMemosFromBackup(parsed.payload.memos);
    setBackupStatus(`JSON 복원 완료: ${parsed.payload.memos.length}개 메모`);
  };

  const handleExportJsonBackup = async () => {
    if (isBusy) {
      return;
    }

    setIsBusy(true);
    try {
      const contents = await createLocalBackupJson();
      if (!isTauri) {
        setBackupStatus("JSON 백업은 설치 앱에서 사용할 수 있습니다.");
        return;
      }

      const result = await exportJsonFile("h-memo-backup.json", contents);
      if (result.status === "saved") {
        setBackupStatus(`JSON 백업 완료: ${result.path}`);
      } else if (result.status === "cancelled") {
        setBackupStatus("JSON 백업을 취소했습니다.");
      } else {
        setBackupStatus(`JSON 백업 실패: ${result.message}`);
      }
    } catch (error) {
      setBackupStatus(`JSON 백업 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportJsonBackup = async () => {
    if (isBusy) {
      return;
    }
    if (!isTauri) {
      setBackupStatus("JSON 복원은 설치 앱에서 사용할 수 있습니다.");
      return;
    }

    setIsBusy(true);
    try {
      const result = await importJsonFile();
      if (result.status === "cancelled") {
        setBackupStatus("JSON 복원을 취소했습니다.");
        return;
      }
      if (result.status === "failed") {
        setBackupStatus(`JSON 복원 실패: ${result.message}`);
        return;
      }

      await restoreLocalBackupJson(result.contents);
    } catch (error) {
      setBackupStatus(`JSON 복원 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
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
    setBackupStatus("구글 로그인 중...");
    try {
      const nextUser = await signInWithGoogle(services.auth, {
        fallbackToRedirect: isTauri,
      });
      if (!nextUser) {
        setBackupStatus("구글 로그인 완료를 확인하는 중입니다...");
        const settledUser = await waitForSignedInUser(services.auth, 8000);
        if (settledUser) {
          setUser(settledUser);
          setBackupStatus(`${settledUser.displayName || settledUser.email || "사용자"}님이 로그인했습니다.`);
          return;
        }
        setBackupStatus("구글 로그인 화면을 완료한 뒤 앱으로 돌아와 주세요.");
        return;
      }
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

  const applyFirebaseConfigState = (nextStoredConfig: Partial<typeof storedFirebaseClientEnv>) => {
    const nextEnv = mergeFirebaseClientConfig(buildFirebaseClientEnv, nextStoredConfig);
    const validation = validateFirebaseClientEnv(nextEnv);

    syncServicesRef.current = null;
    setSyncServicesInitialized(false);
    setServicesAvailable(validation.isValid);
    setUser(null);

    if (validation.isValid) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return;
    }

    setBackupStatus(
      validation.missingRequiredKeys.length > 0
        ? `Firebase 설정에 누락된 값이 있습니다: ${validation.missingRequiredKeys.join(", ")}`
        : FIREBASE_UNAVAILABLE_MESSAGE
    );
  };

  const handleSaveFirebaseConfig = (config: FirebaseConfigFormValue) => {
    try {
      const savedConfig = saveStoredFirebaseClientConfig(config);
      setStoredFirebaseClientEnv(savedConfig);
      applyFirebaseConfigState(savedConfig);
    } catch (error) {
      setBackupStatus(`Firebase 설정 저장 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleClearFirebaseConfig = () => {
    try {
      clearStoredFirebaseClientConfig();
      setStoredFirebaseClientEnv({});
      applyFirebaseConfigState({});
    } catch (error) {
      setBackupStatus(`Firebase 설정 삭제 실패: ${getErrorMessage(error)}`);
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
      await waitForPendingPersists();
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

  const handleRequestWindowDrag = () => {
    if (!isTauri) {
      return;
    }

    void startWindowDrag().catch((error) => {
      setBackupStatus(`창 이동 실패: ${getErrorMessage(error)}`);
    });
  };

  const handleRequestWindowResize = (direction: "SouthEast") => {
    if (!isTauri) {
      return;
    }

    void startWindowResize(direction).catch((error) => {
      setBackupStatus(`창 크기 조절 실패: ${getErrorMessage(error)}`);
    });
  };

  const handleRequestWindowMinimize = () => {
    if (!isTauri) {
      return;
    }

    void persistActiveMemoWindowBounds()
      .then(() => minimizeWindow())
      .catch((error) => {
        setBackupStatus(`창 최소화 실패: ${getErrorMessage(error)}`);
      });
  };

  const handleRequestWindowMaximize = () => {
    if (!isTauri) {
      return;
    }

    void persistActiveMemoWindowBounds()
      .then(() => toggleMaximizeWindow())
      .catch((error) => {
        setBackupStatus(`창 최대화 실패: ${getErrorMessage(error)}`);
      });
  };

  const handleRequestWindowClose = () => {
    if (!isTauri) {
      return;
    }

    void persistActiveMemoWindowBounds()
      .then(() => closeWindow())
      .catch((error) => {
        setBackupStatus(`창 종료 실패: ${getErrorMessage(error)}`);
      });
  };

  const handleRequestCollapseChange = (collapsed: boolean) => {
    if (!isTauri) {
      return;
    }

    const resizeTask = async () => {
      if (collapsed) {
        const currentBounds = await readWindowBounds();
        expandedWindowBoundsRef.current = currentBounds;
        await persistActiveMemoWindowBounds(currentBounds);
        await setWindowHeight(COLLAPSED_WINDOW_HEIGHT);
        return;
      }

      const currentBounds = await readWindowBounds();
      const expandedBounds = expandedWindowBoundsRef.current;
      await restoreWindowBounds({
        x: currentBounds.x,
        y: currentBounds.y,
        width: expandedBounds?.width ?? currentBounds.width,
        height: expandedBounds?.height ?? displayedMemos[0]?.windowState.height ?? 280,
      });
    };

    void resizeTask().catch((error) => {
      setBackupStatus(`메모 접기/펼치기 실패: ${getErrorMessage(error)}`);
    });
  };

  return (
    <MemoWorkspace
      appClassName="desktop-app"
      title="H Memo"
      memos={displayedMemos}
      managedMemos={visibleMemos}
      onCreateMemo={handleCreateMemo}
      onOpenMemo={isTauri ? handleOpenMemo : undefined}
      onMemoChange={handleMemoChange}
      onDeleteMemo={handleDeleteMemo}
      onRequestWindowDrag={handleRequestWindowDrag}
      onRequestWindowResize={handleRequestWindowResize}
      onRequestWindowMinimize={handleRequestWindowMinimize}
      onRequestWindowMaximize={handleRequestWindowMaximize}
      onRequestWindowClose={handleRequestWindowClose}
      onRequestCollapseChange={handleRequestCollapseChange}
      settingsProps={{
        userName: user ? user.displayName || user.email || "구글 계정" : null,
        backupStatus,
        startupEnabled,
        firebaseConfig: allowFirebaseConfigOverride ? firebaseConfigFormValue : undefined,
        onBackup: handleBackup,
        onRestore: handleRestore,
        onExportText: handleGenerateTextPreview,
        onExportJsonBackup: handleExportJsonBackup,
        onImportJsonBackup: handleImportJsonBackup,
        onToggleStartup: handleToggleStartup,
        onSignIn: handleSignIn,
        onSignOut: handleSignOut,
        onSaveFirebaseConfig: allowFirebaseConfigOverride ? handleSaveFirebaseConfig : undefined,
        onClearFirebaseConfig: allowFirebaseConfigOverride ? handleClearFirebaseConfig : undefined,
        isServerAvailable: servicesAvailable,
        isServerBusy: isBusy,
        isBackupDisabled,
        isRestoreDisabled,
        isAuthDisabled,
      }}
    />
  );
}
