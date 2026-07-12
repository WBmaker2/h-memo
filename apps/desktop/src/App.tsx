import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFirestore, type Firestore } from "firebase/firestore";
import type { Auth } from "firebase/auth";
import {
  clearRestoreSafetyPoint,
  MemoryMemoRepository,
  createBackupPayload,
  createMemo,
  formatMemosAsCombinedText,
  loadRestoreSafetyPoint,
  saveRestoreSafetyPoint,
  updateMemoWindowState,
  validateLocalBackupPayload,
  type Memo,
  type MemoRepository,
  type RestoreSafetyPoint,
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
  closeMemoWindow,
  claimCurrentMemoWindow,
  getCurrentWindowLabel,
  listLiveMemoWindowLabels,
  openMemoWindow,
  listenWindowBoundsChanged,
  readWindowBounds,
  releaseCurrentMemoWindow,
  restoreWindowBounds,
  setWindowHeight,
  startWindowDrag,
  startWindowResize,
  type WindowBounds,
} from "./adapters/tauriWindow";
import {
  listenAuthStateChanged,
  listenMemoStoreChanged,
  listenStartupStateChanged,
  listenTrayCreateMemo,
  listenTrayOpenAllMemos,
  notifyAuthStateChanged,
  notifyMemoStoreChanged,
  notifyRestoreLockAcknowledged,
  notifyRestoreLockReleased,
  notifyRestoreLockRequested,
  notifyRestoreStoreApplyAcknowledged,
  notifyRestoreStoreApplyRequested,
  notifyRestoreSafetyChanged,
  notifyStartupStateChanged,
  listenRestoreLockAcknowledged,
  listenRestoreLockReleased,
  listenRestoreLockRequested,
  listenRestoreStoreApplyAcknowledged,
  listenRestoreStoreApplyRequested,
  listenRestoreSafetyChanged,
  type MemoStoreChangedPayload,
} from "./adapters/tauriEvents";
import {
  createRestoreLockCoordinator,
  createTauriRestoreLockLeaseAdapter,
} from "./adapters/restoreLock";
import { startGoogleDesktopOAuth } from "./adapters/tauriGoogleOAuth";
import {
  FirestoreBackupGateway,
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  deleteBackedUpMemo,
  getFirebaseAuth,
  subscribeAuthUser,
  hasFirebaseConfig,
  listBackupSnapshots,
  listBackedUpMemos,
  signInWithGoogle,
  signOutUser,
  waitForSignedInUser,
  type BackedUpSnapshot,
  type BackedUpMemo,
  type GoogleOAuthTokens,
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
import desktopPackageJson from "../package.json";
import { getFirebaseClientEnv } from "./env/firebaseEnv";

type BackupMessage = string;
type SyncServices = {
  auth: Auth;
  firestore: Firestore;
  gateway: FirestoreBackupGateway;
};
type OwnedMemoWindow = {
  memoId: string;
  claimToken: string;
};

const FIREBASE_UNAVAILABLE_MESSAGE =
  "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다.";
const DESKTOP_GOOGLE_OAUTH_REQUIRED_MESSAGE =
  "Windows 데스크톱 구글 로그인에는 Desktop OAuth Client ID 설정이 필요합니다. 빌드 환경에 VITE_GOOGLE_OAUTH_CLIENT_ID를 추가한 설치 파일로 다시 실행해 주세요.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 구글 로그인 후 사용 가능합니다.";
const FIREBASE_INIT_FAILED_PREFIX = "서버 백업 초기화 실패:";
const AUTH_SUBSCRIBE_FAILED_PREFIX = "인증 상태 복구 실패:";
const AUTH_LOGIN_FAILED_PREFIX = "구글 로그인 실패:";
const BACKUP_FAILED_PREFIX = "백업 실패:";
const RESTORE_FAILED_PREFIX = "복원 실패:";
const JSON_RESTORE_CONFIRM_MESSAGE =
  "JSON 백업 파일 내용으로 현재 메모를 대체합니다. 백업에 없는 메모는 삭제됩니다. 계속할까요?";
const DELETE_MEMO_CONFIRM_MESSAGE =
  "아직 백업되지 않는 내용이 있습니다. 정말 삭제하겠습니까?";
const DELETE_SERVER_MEMO_CONFIRM_MESSAGE =
  "서버 백업에서 이 메모를 삭제합니다. 삭제한 뒤에는 서버에서 복원할 수 없습니다. 계속할까요?";
const COLLAPSED_WINDOW_HEIGHT = 46;
const MIN_EXPANDED_WINDOW_HEIGHT = 160;
const RESTORE_SAFETY_POLL_INTERVAL_MS = 250;
const DESKTOP_EVENT_TIMEOUT_MS = 1000;
const APP_VERSION_LABEL = `v${desktopPackageJson.version}`;

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

async function runDesktopEventWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(timeoutMessage)),
      DESKTOP_EVENT_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sortMemos(nextMemos: Memo[]): Memo[] {
  return [...nextMemos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getMemoLabel(memo: Memo): string {
  return memo.plainText.trim().replace(/\s+/g, " ") || "빈 메모";
}

function getRestoreSafetyStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createRestoreSafetyPoint(
  source: RestoreSafetyPoint["source"],
  userId: string,
  memos: Memo[]
): RestoreSafetyPoint {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    source,
    createdAt,
    payload: createBackupPayload({
      userId,
      createdAt,
      memos,
    }),
  };
}

function formatBackupTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString("ko-KR");
}

function getServerRestoreConfirmMessage(snapshot: BackedUpSnapshot): string {
  return `${formatBackupTime(snapshot.createdAt)} 백업의 ${snapshot.memoCount}개 메모로 현재 로컬 메모를 대체합니다. 계속할까요?`;
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
  const restoreSafetyStorage = useMemo(() => getRestoreSafetyStorage(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [restoreSafetyPoint, setRestoreSafetyPoint] = useState<RestoreSafetyPoint | null>(() =>
    restoreSafetyStorage ? loadRestoreSafetyPoint(restoreSafetyStorage) : null
  );
  const [activeMemoId, setActiveMemoId] = useState<string | null>(requestedMemoId);
  const [ownedMemoId, setOwnedMemoId] = useState<string | null>(null);
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
  const googleOAuthClientId = firebaseClientEnv.googleOAuthClientId?.trim() ?? "";
  const needsDesktopGoogleOAuthClient = isTauri && googleOAuthClientId.length === 0;
  const hasFirebaseConfigSet = useMemo(() => hasFirebaseConfig(firebaseClientEnv), [firebaseClientEnv]);
  const [backupStatus, setBackupStatus] = useState<BackupMessage>(
    hasFirebaseConfigSet
      ? needsDesktopGoogleOAuthClient
        ? DESKTOP_GOOGLE_OAUTH_REQUIRED_MESSAGE
        : "백업 정보 없음"
      : FIREBASE_UNAVAILABLE_MESSAGE
  );
  const [user, setUser] = useState<HMemoUser | null>(null);
  const [pendingDeleteMemo, setPendingDeleteMemo] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [serverMemoManager, setServerMemoManager] = useState<{
    isOpen: boolean;
    memos: BackedUpMemo[];
  }>({
    isOpen: false,
    memos: [],
  });
  const [backupHistoryDialog, setBackupHistoryDialog] = useState<{
    isOpen: boolean;
    snapshots: BackedUpSnapshot[];
  }>({
    isOpen: false,
    snapshots: [],
  });
  const [isBusy, setIsBusy] = useState(false);
  const [isRestoreLocked, setIsRestoreLocked] = useState(false);
  const [isRestoreLockReady, setIsRestoreLockReady] = useState(!isTauri);
  const [servicesAvailable, setServicesAvailable] = useState(hasFirebaseConfigSet);
  const [hasLoadedMemos, setHasLoadedMemos] = useState(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistErrorRef = useRef<unknown | null>(null);
  const restoreLockRef = useRef<string | null>(null);
  const restoreLockCoordinatorRef = useRef<ReturnType<typeof createRestoreLockCoordinator> | null>(null);
  const restoreLockWaitRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const restoreStoreApplyRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const restoreLockReadyRef = useRef(!isTauri);
  const restoreLockReadyPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const ownershipQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ownershipGenerationRef = useRef(0);
  const ownedMemoWindowRef = useRef<OwnedMemoWindow | null>(null);
  const memosRef = useRef<Memo[]>([]);
  const restoredMemoIdRef = useRef<string | null>(null);
  const boundsPersistTimerRef = useRef<number | null>(null);
  const expandedWindowBoundsRef = useRef<WindowBounds | null>(null);
  const activeMemoIdRef = useRef<string | null>(requestedMemoId);
  const openedRestoredMemoWindowsRef = useRef(false);
  const userRef = useRef<HMemoUser | null>(null);
  const restoreSnapshotInFlightRef = useRef(false);
  const createMemoFromTrayRef = useRef<() => Promise<void>>(async () => {});
  const openAllMemosFromTrayRef = useRef<() => Promise<void>>(async () => {});

  const syncServicesRef = useRef<SyncServices | null>(null);

  useEffect(() => {
    if (!isTauri) {
      restoreLockReadyRef.current = true;
      setIsRestoreLockReady(true);
      return;
    }

    restoreLockReadyRef.current = false;
    setIsRestoreLockReady(false);
    const coordinator = createRestoreLockCoordinator({
      getCurrentWindowLabel,
      listLiveWindowLabels: listLiveMemoWindowLabels,
      notifyLockRequested: notifyRestoreLockRequested,
      listenLockRequested: listenRestoreLockRequested,
      notifyLockAcknowledged: notifyRestoreLockAcknowledged,
      listenLockAcknowledged: listenRestoreLockAcknowledged,
      notifyLockReleased: notifyRestoreLockReleased,
      listenLockReleased: listenRestoreLockReleased,
      notifyStoreApplyRequested: notifyRestoreStoreApplyRequested,
      listenStoreApplyRequested: listenRestoreStoreApplyRequested,
      notifyStoreApplyAcknowledged: notifyRestoreStoreApplyAcknowledged,
      listenStoreApplyAcknowledged: listenRestoreStoreApplyAcknowledged,
      applyStore: () => restoreStoreApplyRef.current(),
      nativeLease: createTauriRestoreLockLeaseAdapter(),
      lockLocal: (token) => {
        const activeToken = restoreLockRef.current;
        if (activeToken && activeToken !== token) {
          throw new Error("다른 복원 작업이 이미 진행 중입니다.");
        }
        restoreLockRef.current = token;
        setIsRestoreLocked(true);
        return restoreLockWaitRef.current();
      },
      unlockLocal: (token) => {
        if (restoreLockRef.current !== token) {
          return;
        }
        restoreLockRef.current = null;
        setIsRestoreLocked(false);
      },
      onProtocolError: (error) => {
        setBackupStatus(`복원 잠금 공유 실패: ${getErrorMessage(error)}`);
      },
    });
    restoreLockCoordinatorRef.current = coordinator;

    const startup = coordinator
      .start()
      .then(() => {
        restoreLockReadyRef.current = true;
        setIsRestoreLockReady(true);
      })
      .catch((error) => {
        setBackupStatus(`복원 잠금 초기화 실패: ${getErrorMessage(error)}`);
      });
    restoreLockReadyPromiseRef.current = startup;

    return () => {
      restoreLockCoordinatorRef.current = null;
      void coordinator.stop();
    };
  }, [isTauri]);

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
  restoreStoreApplyRef.current = reloadMemos;

  useEffect(() => {
    void reloadMemos();
  }, [reloadMemos]);

  useEffect(() => {
    memosRef.current = memos;
  }, [memos]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    activeMemoIdRef.current = activeMemoId;
  }, [activeMemoId]);

  const setSignedInUser = useCallback(
    (nextUser: HMemoUser, options?: { broadcast?: boolean }) => {
      const status = `${nextUser.displayName || nextUser.email || "사용자"}님이 로그인했습니다.`;
      userRef.current = nextUser;
      setUser(nextUser);
      setBackupStatus(status);
      if (isTauri && options?.broadcast !== false) {
        void notifyAuthStateChanged({ user: nextUser, status }).catch((error) => {
          setBackupStatus(`로그인 상태 공유 실패: ${getErrorMessage(error)}`);
        });
      }
    },
    [isTauri]
  );

  const setSignedOutUser = useCallback(
    (status: string, options?: { broadcast?: boolean }) => {
      userRef.current = null;
      setUser(null);
      setBackupStatus(status);
      if (isTauri && options?.broadcast !== false) {
        void notifyAuthStateChanged({ user: null, status }).catch((error) => {
          setBackupStatus(`로그인 상태 공유 실패: ${getErrorMessage(error)}`);
        });
      }
    },
    [isTauri]
  );

  const authStatus = useMemo(() => {
    if (user) {
      return {
        state: "signed-in" as const,
        label: user.displayName || user.email || "사용자",
        photoUrl: user.photoURL || undefined,
      };
    }

    if (!hasFirebaseConfigSet || !servicesAvailable || needsDesktopGoogleOAuthClient) {
      return {
        state: "unavailable" as const,
        label: "구글 로그인 설정 필요",
      };
    }

    return {
      state: "signed-out" as const,
      label: "구글 로그인 안 됨",
    };
  }, [hasFirebaseConfigSet, needsDesktopGoogleOAuthClient, servicesAvailable, user]);

  const broadcastMemoStoreChanged = useCallback(
    async (payload: Omit<MemoStoreChangedPayload, "sourceId"> = {}) => {
      if (!isTauri) {
        return;
      }
      await runDesktopEventWithTimeout(
        () => notifyMemoStoreChanged(payload),
        "메모 상태 공유가 시간 초과되었습니다."
      );
    },
    [isTauri]
  );

  const broadcastRestoreSafetyChanged = useCallback(async () => {
    if (!isTauri) {
      return;
    }
    try {
      await runDesktopEventWithTimeout(
        notifyRestoreSafetyChanged,
        "복원 안전 지점 공유가 시간 초과되었습니다."
      );
    } catch (error) {
      setBackupStatus(`복원 안전 지점 공유 실패: ${getErrorMessage(error)}`);
    }
  }, [isTauri]);

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
          setSignedInUser(nextUser);
        } else {
          if (userRef.current) {
            return;
          }
          setSignedOutUser(
            needsDesktopGoogleOAuthClient
              ? DESKTOP_GOOGLE_OAUTH_REQUIRED_MESSAGE
              : LOGIN_REQUIRED_MESSAGE,
            { broadcast: false }
          );
        }
      });

      void completeGoogleRedirectSignIn(services.auth)
        .then((nextUser) => {
          if (!isMounted || !nextUser) {
            return;
          }
          setSignedInUser(nextUser);
        })
        .then(async () => {
          const settledUser = await waitForSignedInUser(services.auth, 4000);
          if (!isMounted || !settledUser) {
            return;
          }
          setSignedInUser(settledUser);
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
  }, [
    ensureSyncServices,
    hasFirebaseConfigSet,
    needsDesktopGoogleOAuthClient,
    setSignedInUser,
    setSignedOutUser,
  ]);

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

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isMounted = true;
    let cleanup: (() => void) | null = null;

    void listenMemoStoreChanged((payload) => {
      const activeMemoId = activeMemoIdRef.current;
      void reloadMemos().then(() => {
        if (!isMounted || !payload.deletedMemoId || payload.deletedMemoId !== activeMemoId) {
          return;
        }
        void closeWindow().catch((error) => {
          setBackupStatus(`삭제된 메모 창 닫기 실패: ${getErrorMessage(error)}`);
        });
      });
    })
      .then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        setBackupStatus(`메모 상태 공유 수신 실패: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
      cleanup?.();
    };
  }, [isTauri, reloadMemos]);

  useEffect(() => {
    if (!isTauri || !restoreSafetyStorage) {
      return;
    }

    let isMounted = true;
    let cleanup: (() => void) | null = null;
    const reloadRestoreSafety = () => {
      if (!isMounted) {
        return;
      }
      setRestoreSafetyPoint(loadRestoreSafetyPoint(restoreSafetyStorage));
    };
    const pollId = window.setInterval(reloadRestoreSafety, RESTORE_SAFETY_POLL_INTERVAL_MS);

    void listenRestoreSafetyChanged(reloadRestoreSafety)
      .then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        setBackupStatus(`복원 안전 지점 공유 수신 실패: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
      cleanup?.();
      window.clearInterval(pollId);
    };
  }, [isTauri, restoreSafetyStorage]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isMounted = true;
    let cleanup: (() => void) | null = null;

    void listenAuthStateChanged((payload) => {
      if (!isMounted) {
        return;
      }
      if (payload.user) {
        setSignedInUser(payload.user, { broadcast: false });
        return;
      }
      setSignedOutUser(payload.status, { broadcast: false });
    })
      .then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        setBackupStatus(`로그인 상태 공유 수신 실패: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
      cleanup?.();
    };
  }, [isTauri, setSignedInUser, setSignedOutUser]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isMounted = true;
    let cleanup: (() => void) | null = null;

    void listenStartupStateChanged((payload) => {
      if (!isMounted) {
        return;
      }
      setStartupEnabled(payload.enabled);
    })
      .then((unlisten) => {
        if (!isMounted) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        setBackupStatus(`시작프로그램 상태 공유 수신 실패: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
      cleanup?.();
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
    if (activeMemoId !== ownedMemoId) {
      return [];
    }
    return visibleMemos.filter((memo) => memo.id === activeMemoId);
  }, [activeMemoId, isTauri, ownedMemoId, visibleMemos]);

  useEffect(() => {
    if (!isTauri || !hasLoadedMemos) {
      return;
    }

    if (activeMemoId && visibleMemos.some((memo) => memo.id === activeMemoId)) {
      return;
    }

    setActiveMemoId(visibleMemos[0]?.id ?? null);
  }, [activeMemoId, hasLoadedMemos, isTauri, visibleMemos]);

  const queueMemoWindowOwnership = useCallback((memoId: string | null, generation: number) => {
    const transition = async () => {
      await restoreLockReadyPromiseRef.current;
      if (!restoreLockReadyRef.current || restoreLockRef.current) {
        return;
      }
      const previous = ownedMemoWindowRef.current;
      if (previous && previous.memoId !== memoId) {
        await releaseCurrentMemoWindow(previous.memoId, previous.claimToken);
        if (ownedMemoWindowRef.current === previous) {
          ownedMemoWindowRef.current = null;
          setOwnedMemoId(null);
        }
      }

      if (!memoId) {
        return;
      }

      const currentOwner = ownedMemoWindowRef.current;
      if (currentOwner?.memoId === memoId) {
        if (generation === ownershipGenerationRef.current) {
          setOwnedMemoId(memoId);
        }
        return;
      }

      const claim = await claimCurrentMemoWindow(memoId);
      if (!claim.claimed || !claim.claimToken) {
        if (generation === ownershipGenerationRef.current) {
          setOwnedMemoId(null);
        }
        return;
      }

      if (generation !== ownershipGenerationRef.current) {
        await releaseCurrentMemoWindow(memoId, claim.claimToken);
        return;
      }

      ownedMemoWindowRef.current = { memoId, claimToken: claim.claimToken };
      setOwnedMemoId(memoId);
    };

    const queued = ownershipQueueRef.current.then(transition, transition);
    ownershipQueueRef.current = queued.catch((error) => {
      setBackupStatus(`메모 창 소유권 처리 실패: ${getErrorMessage(error)}`);
    });
  }, []);

  useEffect(() => {
    if (
      !isTauri ||
      !isRestoreLockReady ||
      !hasLoadedMemos ||
      isRestoreLocked ||
      restoreLockRef.current
    ) {
      return;
    }

    const generation = ++ownershipGenerationRef.current;
    queueMemoWindowOwnership(activeMemoId, generation);
  }, [
    activeMemoId,
    hasLoadedMemos,
    isRestoreLockReady,
    isRestoreLocked,
    isTauri,
    queueMemoWindowOwnership,
  ]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    return () => {
      const generation = ++ownershipGenerationRef.current;
      queueMemoWindowOwnership(null, generation);
    };
  }, [isTauri, queueMemoWindowOwnership]);

  useEffect(() => {
    if (
      !isTauri ||
      !isRestoreLockReady ||
      restoreLockRef.current ||
      requestedMemoId ||
      !hasLoadedMemos ||
      openedRestoredMemoWindowsRef.current
    ) {
      return;
    }

    const currentMemoId = activeMemoId ?? visibleMemos[0]?.id;
    if (!currentMemoId) {
      return;
    }

    openedRestoredMemoWindowsRef.current = true;
    for (const memo of visibleMemos) {
      if (restoreLockRef.current) {
        break;
      }
      if (memo.id === currentMemoId) {
        continue;
      }
      void openMemoWindow(memo).catch((error) => {
        setBackupStatus(`메모 창 열기 실패: ${getErrorMessage(error)}`);
      });
    }
  }, [
    activeMemoId,
    hasLoadedMemos,
    isRestoreLockReady,
    isTauri,
    requestedMemoId,
    visibleMemos,
  ]);

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

  const enqueuePersist = <T,>(operation: () => Promise<T>) => {
    if (!restoreLockReadyRef.current || restoreLockRef.current) {
      return Promise.reject(new Error("복원 작업 중에는 메모를 저장할 수 없습니다."));
    }
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

  restoreLockWaitRef.current = waitForPendingPersists;

  const persistMemo = (nextMemo: Memo, options?: { skipStateUpdate: boolean }) => {
    if (!restoreLockReadyRef.current || restoreLockRef.current) {
      return Promise.reject(new Error("복원 작업 중에는 메모를 저장할 수 없습니다."));
    }
    return enqueuePersist(async () => {
      const saved = await repository.saveMemo(nextMemo);
      if (!options?.skipStateUpdate) {
        upsertMemo(saved);
      }
      void broadcastMemoStoreChanged({ memoId: saved.id }).catch((error) => {
        setBackupStatus(`메모 상태 공유 실패: ${getErrorMessage(error)}`);
      });
      return saved;
    });
  };

  const persistActiveMemoWindowBounds = useCallback(
    async (boundsOverride?: WindowBounds) => {
      if (!isTauri || !restoreLockReadyRef.current || restoreLockRef.current) {
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

      if (!restoreLockReadyRef.current || restoreLockRef.current) {
        return;
      }
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

  const rollbackRestoreAttempt = async (
    currentMemos: Memo[],
    writtenMemos: Memo[]
  ): Promise<unknown[]> => {
    const currentIds = new Set(currentMemos.map((memo) => memo.id));
    const rollbackAt = new Date().toISOString();

    const deleteResults = await Promise.allSettled(
      writtenMemos
        .filter((memo) => !currentIds.has(memo.id))
        .map((memo) => repository.softDeleteMemo(memo.id, rollbackAt))
    );
    const saveResults = await Promise.allSettled(
      currentMemos.map((memo) => repository.saveMemo(memo))
    );
    return [...deleteResults, ...saveResults]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
  };

  const replaceMemosFromBackup = async (
    nextMemos: Memo[],
    previousMemos?: Memo[],
    synchronize?: () => Promise<void>
  ) => {
    const currentMemos = previousMemos ?? (await repository.listMemos());
    const keptIds = new Set(nextMemos.map((memo) => memo.id));
    const removedAt = new Date().toISOString();
    const writtenMemos: Memo[] = [];

    try {
      for (const memo of nextMemos) {
        await repository.saveMemo(memo);
        writtenMemos.push(memo);
      }
      for (const memo of currentMemos) {
        if (!keptIds.has(memo.id)) {
          await repository.softDeleteMemo(memo.id, removedAt);
        }
      }
      const sortedMemos = sortMemos(nextMemos);
      memosRef.current = sortedMemos;
      setMemos(sortedMemos);
      await synchronize?.();
      await broadcastMemoStoreChanged();
    } catch (error) {
      const rollbackErrors = await rollbackRestoreAttempt(
        currentMemos,
        writtenMemos
      );
      const restoredMemos = sortMemos(currentMemos);
      memosRef.current = restoredMemos;
      setMemos(restoredMemos);
      if (synchronize) {
        try {
          await synchronize();
        } catch (rollbackApplyError) {
          rollbackErrors.push(rollbackApplyError);
        }
      }
      try {
        await broadcastMemoStoreChanged();
      } catch (rollbackEventError) {
        rollbackErrors.push(rollbackEventError);
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `복원 실패 후 원상 복구에도 실패했습니다: ${[
            error,
            ...rollbackErrors,
          ]
            .map(getErrorMessage)
            .join(" / ")}`
        );
      }
      throw error;
    }
  };

  const runWithDesktopRestoreLock = async <T,>(
    operation: (synchronize: () => Promise<void>) => Promise<T>
  ) => {
    if (!isTauri) {
      return operation(() => Promise.resolve());
    }

    const coordinator = restoreLockCoordinatorRef.current;
    if (!coordinator) {
      throw new Error("복원 잠금을 초기화하지 못했습니다.");
    }

    return coordinator.run((token) => {
      if (!(repository instanceof TauriMemoRepository)) {
        throw new Error("복원 저장소 범위를 초기화하지 못했습니다.");
      }
      return repository.withRestoreToken(token, () =>
        operation(() => coordinator.synchronize(token))
      );
    });
  };

  const replaceMemosWithSafety = async (
    source: RestoreSafetyPoint["source"],
    userId: string,
    nextMemos: Memo[] | ((currentMemos: Memo[]) => Memo[]),
    synchronize?: () => Promise<void>
  ) => {
    if (!restoreSafetyStorage) {
      throw new Error("복원 안전 지점을 저장할 저장 공간을 사용할 수 없습니다.");
    }

    const currentMemos = await repository.listMemos();
    const safetyPoint = createRestoreSafetyPoint(source, userId, currentMemos);
    saveRestoreSafetyPoint(restoreSafetyStorage, safetyPoint);
    const replacementMemos =
      typeof nextMemos === "function" ? nextMemos(currentMemos) : nextMemos;
    await replaceMemosFromBackup(replacementMemos, currentMemos, synchronize);
    setRestoreSafetyPoint(safetyPoint);
    await broadcastRestoreSafetyChanged();
  };

  const handleCreateMemo = async () => {
    await restoreLockReadyPromiseRef.current;
    if (!restoreLockReadyRef.current || restoreLockRef.current) {
      return;
    }
    const hadExistingVisibleMemo = memosRef.current.some(
      (memo) => memo.deletedAt === null
    );
    const now = new Date().toISOString();
    const nextMemo = createMemo({
      id: createMemoId(),
      now,
      title: "",
    });

    await persistMemo(nextMemo);
    if (restoreLockRef.current) {
      return;
    }
    if (!isTauri) {
      return;
    }
    if (!activeMemoIdRef.current && !hadExistingVisibleMemo) {
      setActiveMemoId(nextMemo.id);
      return;
    }
    await openMemoWindow(nextMemo);
  };

  const handleOpenAllMemos = async () => {
    await restoreLockReadyPromiseRef.current;
    if (!isTauri || !restoreLockReadyRef.current || restoreLockRef.current) {
      return;
    }

    await waitForPendingPersists();
    const storedMemos = sortMemos(await repository.listMemos());
    const visibleStoredMemos = storedMemos.filter((memo) => memo.deletedAt === null);

    memosRef.current = storedMemos;
    setMemos(storedMemos);

    if (visibleStoredMemos.length === 0) {
      await handleCreateMemo();
      return;
    }

    const currentActiveMemoId = activeMemoIdRef.current;
    const mainWindowMemo =
      visibleStoredMemos.find((memo) => memo.id === currentActiveMemoId) ??
      visibleStoredMemos[0];

    if (mainWindowMemo.id !== currentActiveMemoId) {
      setActiveMemoId(mainWindowMemo.id);
    }

    for (const memo of visibleStoredMemos) {
      if (restoreLockRef.current) {
        return;
      }
      if (memo.id === mainWindowMemo.id) {
        continue;
      }
      await openMemoWindow(memo);
    }

    setBackupStatus(`메모 ${visibleStoredMemos.length}개를 열었습니다.`);
  };

  useEffect(() => {
    createMemoFromTrayRef.current = handleCreateMemo;
    openAllMemosFromTrayRef.current = handleOpenAllMemos;
  });

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isMounted = true;
    let cleanupOpenAll: (() => void) | null = null;
    let cleanupCreateMemo: (() => void) | null = null;

    void Promise.all([
      listenTrayOpenAllMemos(() => {
        void openAllMemosFromTrayRef.current().catch((error) => {
          setBackupStatus(`트레이 메모 열기 실패: ${getErrorMessage(error)}`);
        });
      }),
      listenTrayCreateMemo(() => {
        void createMemoFromTrayRef.current().catch((error) => {
          setBackupStatus(`트레이 새 메모 생성 실패: ${getErrorMessage(error)}`);
        });
      }),
    ])
      .then(([unlistenOpenAll, unlistenCreateMemo]) => {
        if (!isMounted) {
          unlistenOpenAll();
          unlistenCreateMemo();
          return;
        }
        cleanupOpenAll = unlistenOpenAll;
        cleanupCreateMemo = unlistenCreateMemo;
      })
      .catch((error) => {
        setBackupStatus(`트레이 동작 수신 실패: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
      cleanupOpenAll?.();
      cleanupCreateMemo?.();
    };
  }, [isTauri]);

  const handleOpenMemo = async (memoId: string) => {
    if (!restoreLockReadyRef.current || restoreLockRef.current) {
      return;
    }
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
    if (!restoreLockReadyRef.current || restoreLockRef.current) {
      return;
    }
    upsertMemo(nextMemo);
    void persistMemo(nextMemo, { skipStateUpdate: true }).catch((error) => {
      setBackupStatus(`메모 저장 실패: ${getErrorMessage(error)}`);
    });
  };

  const handleDeleteMemo = async (memoId: string) => {
    if (!restoreLockReadyRef.current || restoreLockRef.current) {
      return;
    }
    const target = memos.find((memo) => memo.id === memoId);
    if (!target) {
      return;
    }

    if (target.deletedAt === null && visibleMemos.length <= 1) {
      setBackupStatus("마지막 남은 메모는 삭제할 수 없습니다.");
      return;
    }

    setPendingDeleteMemo({
      id: target.id,
      label: getMemoLabel(target),
    });
  };

  const performDeleteMemoLocked = async (memoId: string, status = "메모를 삭제했습니다.") => {
    const target = memosRef.current.find((memo) => memo.id === memoId);
    if (!target) {
      setPendingDeleteMemo(null);
      return false;
    }

    const currentVisibleMemos = memosRef.current.filter((memo) => memo.deletedAt === null);
    if (target.deletedAt === null && currentVisibleMemos.length <= 1) {
      setPendingDeleteMemo(null);
      setBackupStatus("마지막 남은 메모는 삭제할 수 없습니다.");
      return false;
    }

    const deletedAt = new Date().toISOString();
    const deleted = await repository.softDeleteMemo(memoId, deletedAt);
    upsertMemo(deleted);
    setPendingDeleteMemo(null);
    setBackupStatus(status);
    void broadcastMemoStoreChanged({ deletedMemoId: memoId }).catch((error) => {
      setBackupStatus(`메모 상태 공유 실패: ${getErrorMessage(error)}`);
    });
    return isTauri && activeMemoIdRef.current === memoId;
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

    await runWithDesktopRestoreLock((synchronize) =>
      replaceMemosWithSafety(
        "json",
        user?.uid ?? "local",
        parsed.payload.memos,
        synchronize
      )
    );
    setBackupStatus(`JSON 복원 완료: ${parsed.payload.memos.length}개 메모`);
  };

  const handleUndoRestore = async () => {
    if (isBusy) {
      return;
    }
    if (!restoreSafetyStorage) {
      setBackupStatus("복원 되돌리기 실패: 안전 지점 저장 공간을 사용할 수 없습니다.");
      return;
    }

    setIsBusy(true);
    setBackupStatus("마지막 복원을 되돌리는 중입니다.");
    try {
      await runWithDesktopRestoreLock(async (synchronize) => {
        const safetyPoint = loadRestoreSafetyPoint(restoreSafetyStorage);
        if (!safetyPoint) {
          throw new Error("되돌릴 복원 안전 지점이 없습니다.");
        }
        await replaceMemosFromBackup(
          safetyPoint.payload.memos,
          undefined,
          synchronize
        );
        clearRestoreSafetyPoint(restoreSafetyStorage);
        setRestoreSafetyPoint(null);
        await broadcastRestoreSafetyChanged();
      });
      setBackupStatus("마지막 복원을 되돌렸습니다.");
    } catch (error) {
      setBackupStatus(`복원 되돌리기 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
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
    if (needsDesktopGoogleOAuthClient) {
      setBackupStatus(DESKTOP_GOOGLE_OAUTH_REQUIRED_MESSAGE);
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
      const desktopOAuth = isTauri
        ? (): Promise<GoogleOAuthTokens> => startGoogleDesktopOAuth(googleOAuthClientId)
        : undefined;
      const nextUser = await signInWithGoogle(services.auth, {
        desktopOAuth,
        fallbackToRedirect: false,
      });
      if (!nextUser) {
        setBackupStatus("구글 로그인 완료를 확인하는 중입니다...");
        const settledUser = await waitForSignedInUser(services.auth, 8000);
        if (settledUser) {
          setSignedInUser(settledUser);
          return;
        }
        setBackupStatus("구글 로그인 화면을 완료한 뒤 앱으로 돌아와 주세요.");
        return;
      }
      setSignedInUser(nextUser);
    } catch (error) {
      setBackupStatus(`${AUTH_LOGIN_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignOut = async () => {
    const services = ensureSyncServices();
    if (!services) {
      setSignedOutUser("로그아웃했습니다.");
      return;
    }

    setIsBusy(true);
    try {
      await signOutUser(services.auth);
      setSignedOutUser("로그아웃했습니다.");
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

  const runServerBackup = async () => {
    const services = ensureSyncServices();
    if (!user) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return false;
    }

    if (!services || !servicesAvailable) {
      setBackupStatus(`${FIREBASE_INIT_FAILED_PREFIX} 구성 값을 확인해 주세요.`);
      return false;
    }

    if (isBusy) {
      return false;
    }

    setIsBusy(true);
    setBackupStatus("백업을 시작합니다.");
    try {
      const result = await runWithDesktopRestoreLock(async () => {
        await waitForPendingPersists();
        const persistedMemos = await repository.listMemos();
        return backupMemos(services.gateway, user.uid, persistedMemos);
      });
      setBackupStatus(`백업 완료: ${result.path}`);
      return true;
    } catch (error) {
      setBackupStatus(`${BACKUP_FAILED_PREFIX} ${getErrorMessage(error)}`);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const handleBackup = async () => {
    await runServerBackup();
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
    setBackupStatus("백업 기록을 불러옵니다.");
    try {
      await waitForPendingPersists();
      const snapshots = await listBackupSnapshots(services.gateway, user.uid);

      if (snapshots.length === 0) {
        setBackupStatus("복원할 백업이 없습니다.");
        return;
      }

      setBackupHistoryDialog({
        isOpen: true,
        snapshots,
      });
      setBackupStatus(`백업 기록 ${snapshots.length}개를 불러왔습니다.`);
    } catch (error) {
      setBackupStatus(`${RESTORE_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCloseBackupHistoryDialog = () => {
    setBackupHistoryDialog((previous) => ({ ...previous, isOpen: false }));
  };

  const handleRestoreBackupSnapshot = async (snapshotIndex: number) => {
    const snapshot = backupHistoryDialog.snapshots[snapshotIndex];
    if (!snapshot || restoreSnapshotInFlightRef.current || (isBusy && !isRestoreLocked)) {
      return;
    }

    restoreSnapshotInFlightRef.current = true;
    setIsBusy(true);
    setBackupStatus("선택한 백업을 복원합니다.");
    try {
      if (!window.confirm(getServerRestoreConfirmMessage(snapshot))) {
        setBackupStatus("복원을 취소했습니다.");
        return;
      }
      await runWithDesktopRestoreLock((synchronize) =>
        replaceMemosWithSafety(
          "server",
          user?.uid ?? "local",
          snapshot.payload.memos,
          synchronize
        )
      );
      setBackupHistoryDialog({ isOpen: false, snapshots: [] });
      setBackupStatus(`복원 완료: ${snapshot.payload.memos.length}개 메모`);
    } catch (error) {
      setBackupStatus(`${RESTORE_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
      restoreSnapshotInFlightRef.current = false;
    }
  };

  const refreshServerMemoManager = async () => {
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
    setServerMemoManager((previous) => ({ ...previous, isOpen: true }));
    setBackupStatus("서버 메모 목록을 불러옵니다.");
    try {
      const backedUpMemos = await listBackedUpMemos(services.gateway, user.uid);
      setServerMemoManager({
        isOpen: true,
        memos: backedUpMemos,
      });
      setBackupStatus(`서버 메모 ${backedUpMemos.length}개를 불러왔습니다.`);
    } catch (error) {
      setBackupStatus(`서버 메모 목록 불러오기 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCloseServerMemoManager = () => {
    setServerMemoManager((previous) => ({ ...previous, isOpen: false }));
  };

  const handleRestoreServerMemo = async (memoId: string) => {
    const backedUpMemo = serverMemoManager.memos.find((item) => item.memo.id === memoId);
    if (!backedUpMemo || isBusy) {
      return;
    }

    setIsBusy(true);
    try {
      const now = new Date().toISOString();
      const restoredMemo: Memo = {
        ...backedUpMemo.memo,
        deletedAt: null,
        updatedAt: now,
        syncState: "queued",
        windowState: {
          ...backedUpMemo.memo.windowState,
          visible: true,
        },
      };
      await runWithDesktopRestoreLock((synchronize) =>
        replaceMemosWithSafety(
          "server",
          user?.uid ?? "local",
          (currentMemos) => {
            const hasTarget = currentMemos.some(
              (memo) => memo.id === restoredMemo.id
            );
            return hasTarget
              ? currentMemos.map((memo) =>
                  memo.id === restoredMemo.id ? restoredMemo : memo
                )
              : [...currentMemos, restoredMemo];
          },
          synchronize
        )
      );
      const savedMemo = memosRef.current.find((memo) => memo.id === restoredMemo.id) ?? restoredMemo;
      setBackupStatus("서버 백업에서 메모를 복원했습니다.");

      if (!isTauri) {
        return;
      }
      if (restoreLockRef.current) {
        return;
      }
      if (!activeMemoIdRef.current) {
        setActiveMemoId(savedMemo.id);
        return;
      }
      if (activeMemoIdRef.current !== savedMemo.id) {
        await openMemoWindow(savedMemo);
      }
    } catch (error) {
      setBackupStatus(`서버 메모 복원 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteServerMemo = async (memoId: string, memoLabel: string) => {
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

    if (!window.confirm(DELETE_SERVER_MEMO_CONFIRM_MESSAGE)) {
      setBackupStatus("서버 메모 삭제를 취소했습니다.");
      return;
    }

    setIsBusy(true);
    try {
      const targetMemoLabel = memoLabel || "메모";
      const deletedServerRecordCount = await runWithDesktopRestoreLock(() =>
        deleteBackedUpMemo(services.gateway, user.uid, memoId)
      );
      if (deletedServerRecordCount > 0) {
        setServerMemoManager((previous) => ({
          ...previous,
          memos: previous.memos.filter((item) => item.memo.id !== memoId),
        }));
        setBackupStatus(`서버 백업에서 "${targetMemoLabel}" 메모를 삭제했습니다.`);
        return;
      }

      setBackupStatus(
        `서버 백업에서 "${targetMemoLabel}" 메모를 찾지 못했습니다. 목록을 새로고침해 주세요.`
      );
    } catch (error) {
      setBackupStatus(`서버 메모 삭제 실패: ${getErrorMessage(error)}`);
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
      void notifyStartupStateChanged({ enabled: nextEnabled }).catch((error) => {
        setBackupStatus(`시작프로그램 상태 공유 실패: ${getErrorMessage(error)}`);
      });
      if (nextEnabled !== enabled) {
        setBackupStatus("시작프로그램 설정을 변경하지 못했습니다.");
      }
    } catch {
      setStartupEnabled(previousEnabled);
      setBackupStatus("시작프로그램 설정을 변경하지 못했습니다.");
    }
  };

  const handleCancelDeleteMemo = () => {
    setPendingDeleteMemo(null);
    setBackupStatus("메모 삭제를 취소했습니다.");
  };

  const handleDeleteWithoutBackup = async () => {
    if (!pendingDeleteMemo) {
      return;
    }
    if (isBusy) {
      return;
    }

    setIsBusy(true);
    try {
      const pendingMemo = pendingDeleteMemo;
      const shouldCloseWindow = await runWithDesktopRestoreLock(async () => {
        let deletedFromServer = false;
        if (user) {
          const services = ensureSyncServices();
          if (!services || !servicesAvailable) {
            throw new Error("서버 연결 상태를 확인해 주세요.");
          }
          await deleteBackedUpMemo(services.gateway, user.uid, pendingMemo.id);
          deletedFromServer = true;
        }

        return performDeleteMemoLocked(
          pendingMemo.id,
          deletedFromServer
            ? "로컬과 서버에서 메모를 삭제했습니다."
            : "메모를 로컬에서 삭제했습니다."
        );
      });
      if (shouldCloseWindow) {
        await closeWindow();
      }
    } catch (error) {
      setBackupStatus(`메모 삭제 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleBackupThenClose = async () => {
    if (!pendingDeleteMemo) {
      return;
    }
    const didBackup = await runServerBackup();
    if (!didBackup) {
      return;
    }
    setPendingDeleteMemo(null);
    setBackupStatus("백업 후 메모창을 닫았습니다.");

    if (!isTauri) {
      return;
    }

    try {
      if (activeMemoIdRef.current === pendingDeleteMemo.id) {
        await closeWindow();
      } else {
        await closeMemoWindow(pendingDeleteMemo.id);
      }
    } catch (error) {
      setBackupStatus(`메모창 닫기 실패: ${getErrorMessage(error)}`);
    }
  };

  const isServerReady = hasFirebaseConfigSet && servicesAvailable;
  const isBackupDisabled =
    !isServerReady || user === null || isBusy || isRestoreLocked || !isRestoreLockReady || !syncServicesInitialized;
  const isRestoreDisabled =
    !isServerReady || user === null || isBusy || isRestoreLocked || !isRestoreLockReady || !syncServicesInitialized;
  const isAuthDisabled =
    !isServerReady || isBusy || isRestoreLocked || !isRestoreLockReady || needsDesktopGoogleOAuthClient;
  const isServerMemoManagerDisabled =
    !isServerReady || user === null || isBusy || isRestoreLocked || !isRestoreLockReady || !syncServicesInitialized;

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

  const handleRequestWindowClose = () => {
    if (!isTauri || !restoreLockReadyRef.current || restoreLockRef.current) {
      return;
    }

    void persistActiveMemoWindowBounds()
      .then(() => {
        if (restoreLockRef.current) {
          return;
        }
        return closeWindow();
      })
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
    <>
      <MemoWorkspace
        appClassName="desktop-app"
        title="H Memo"
        appVersion={APP_VERSION_LABEL}
        memos={displayedMemos}
        managedMemos={visibleMemos}
        authStatus={authStatus}
        onCreateMemo={handleCreateMemo}
        onOpenMemo={isTauri ? handleOpenMemo : undefined}
        onMemoChange={handleMemoChange}
        onDeleteMemo={handleDeleteMemo}
        onRequestSync={handleBackup}
        isSyncDisabled={isBackupDisabled}
        isSyncBusy={isBusy || isRestoreLocked}
        isMemoEditingDisabled={isRestoreLocked || !isRestoreLockReady}
        actions={
          <button
            type="button"
            onClick={refreshServerMemoManager}
            disabled={isServerMemoManagerDisabled}
          >
            서버 메모 관리
          </button>
        }
        onRequestWindowDrag={handleRequestWindowDrag}
        onRequestWindowResize={handleRequestWindowResize}
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
          isServerBusy: isBusy || isRestoreLocked,
          isBackupDisabled,
          isRestoreDisabled,
          canUndoRestore: restoreSafetyPoint !== null,
          onUndoRestore: handleUndoRestore,
          isAuthDisabled,
        }}
      />
      {pendingDeleteMemo ? (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
          >
            <h2 id="delete-dialog-title">메모 삭제</h2>
            <p>{DELETE_MEMO_CONFIRM_MESSAGE}</p>
            <p className="delete-dialog__memo-name">{pendingDeleteMemo.label}</p>
            <div className="delete-dialog__actions">
              <button type="button" onClick={handleBackupThenClose} disabled={isBusy}>
                지금 백업하기
              </button>
              <button type="button" onClick={handleDeleteWithoutBackup} disabled={isBusy}>
                삭제하기
              </button>
              <button type="button" onClick={handleCancelDeleteMemo}>
                취소하기
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {backupHistoryDialog.isOpen ? (
        <div className="backup-history-dialog-backdrop">
          <section
            className="backup-history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-history-dialog-title"
          >
            <header className="backup-history-dialog__header">
              <h2 id="backup-history-dialog-title">백업 기록 선택</h2>
              <button type="button" onClick={handleCloseBackupHistoryDialog}>
                닫기
              </button>
            </header>
            <p className="backup-history-dialog__description">
              복원할 백업 시간대를 선택해 주세요. 선택한 백업에 포함된 메모로 현재
              로컬 메모가 교체됩니다.
            </p>
            <ul className="backup-history-list">
              {backupHistoryDialog.snapshots.map((snapshot, index) => {
                const preview =
                  snapshot.payload.memos
                    .slice(0, 3)
                    .map(getMemoLabel)
                    .join(", ") || "메모 없음";

                return (
                  <li
                    key={`${snapshot.createdAt}-${index}`}
                    className="backup-history-list__item"
                  >
                    <div className="backup-history-list__content">
                      <strong>{snapshot.createdAt}</strong>
                      <span>{snapshot.memoCount}개 메모</span>
                      <span title={preview}>미리보기: {preview}</span>
                    </div>
                    <div className="backup-history-list__actions">
                      <button
                        type="button"
                        onClick={() => handleRestoreBackupSnapshot(index)}
                      >
                        복원
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}
      {serverMemoManager.isOpen ? (
        <div className="server-memo-dialog-backdrop">
          <section
            className="server-memo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="server-memo-dialog-title"
          >
            <header className="server-memo-dialog__header">
              <h2 id="server-memo-dialog-title">서버 메모 관리</h2>
              <button type="button" onClick={handleCloseServerMemoManager}>
                닫기
              </button>
            </header>
            <p className="server-memo-dialog__description">
              DB에 저장된 메모를 확인하고 필요한 메모는 복원할 수 있습니다.
            </p>
            <div className="server-memo-dialog__toolbar">
              <button
                type="button"
                onClick={refreshServerMemoManager}
                disabled={isServerMemoManagerDisabled}
              >
                새로고침
              </button>
            </div>
            {serverMemoManager.memos.length > 0 ? (
              <ul className="server-memo-list">
                {serverMemoManager.memos.map((item) => (
                  <li key={item.memo.id} className="server-memo-list__item">
                    <div className="server-memo-list__content">
                      <strong>{getMemoLabel(item.memo)}</strong>
                      <span>백업 시각: {item.backupCreatedAt}</span>
                      {item.memo.deletedAt ? <span>로컬 삭제 기록 있음</span> : null}
                    </div>
                    <div className="server-memo-list__actions">
                      <button
                        type="button"
                        onClick={() => handleRestoreServerMemo(item.memo.id)}
                        disabled={isBusy || isRestoreLocked}
                      >
                        복원
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteServerMemo(item.memo.id, getMemoLabel(item.memo))}
                        disabled={isBusy || isRestoreLocked}
                      >
                        서버 삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="server-memo-list__empty">서버에 저장된 메모가 없습니다.</p>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
