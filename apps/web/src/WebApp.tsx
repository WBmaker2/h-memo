import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import {
  clearRestoreSafetyPoint,
  createMemo,
  createBackupPayload,
  formatMemosAsCombinedText,
  loadRestoreSafetyPoint,
  saveRestoreSafetyPoint,
  validateLocalBackupPayload,
  type Memo,
  type MemoRepository,
  type RestoreSafetyPoint,
} from "@h-memo/memo-core";
import { MemoWorkspace, ServerMemoManagerDialog } from "@h-memo/memo-ui";
import {
  FirestoreBackupGateway,
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  deleteBackedUpMemo,
  getFirebaseAuth,
  hasFirebaseConfig,
  listBackedUpMemos,
  listBackupSnapshots,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
  waitForSignedInUser,
  type BackedUpMemo,
  type BackedUpSnapshot,
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
import type { FirebaseConfigFormValue } from "@h-memo/memo-ui";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { LocalStorageMemoRepository } from "./adapters/localStorageMemoRepository";

const FIREBASE_UNAVAILABLE_MESSAGE =
  "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 구글 로그인 후 사용 가능합니다.";
const BROWSER_BACKUP_READY_MESSAGE = "백업 정보 없음";
const FIREBASE_INIT_FAILED_PREFIX = "서버 백업 초기화 실패:";
const AUTH_SUBSCRIBE_FAILED_PREFIX = "인증 상태 복구 실패:";
const AUTH_LOGIN_FAILED_PREFIX = "구글 로그인 실패:";
const BACKUP_FAILED_PREFIX = "백업 실패:";
const RESTORE_FAILED_PREFIX = "복원 실패:";
const JSON_RESTORE_CONFIRM_MESSAGE =
  "JSON 백업 파일 내용으로 현재 메모를 대체합니다. 백업에 없는 메모는 삭제됩니다. 계속할까요?";
const NO_BACKUP_MESSAGE = "복원할 백업이 없습니다.";
const SERVER_MEMO_INITIAL_STATUS = "서버 메모를 불러오지 않았습니다.";

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

function readTextFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("파일을 읽지 못했습니다.")));
    reader.readAsText(file);
  });
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

export function WebApp() {
  const repository = useMemo<MemoRepository>(() => createRepository(), []);
  const restoreSafetyStorage = useMemo(() => getRestoreSafetyStorage(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [restoreSafetyPoint, setRestoreSafetyPoint] = useState<RestoreSafetyPoint | null>(() =>
    restoreSafetyStorage ? loadRestoreSafetyPoint(restoreSafetyStorage) : null
  );
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupMessage>(BROWSER_BACKUP_READY_MESSAGE);
  const [user, setUser] = useState<WebPreviewUser | null>(null);
  const [backupHistoryDialog, setBackupHistoryDialog] = useState<{
    isOpen: boolean;
    snapshots: BackedUpSnapshot[];
  }>({
    isOpen: false,
    snapshots: [],
  });
  const [isBusy, setIsBusy] = useState(false);
  const [syncServicesInitialized, setSyncServicesInitialized] = useState(false);
  const [serverMemoManagerOpen, setServerMemoManagerOpen] = useState(false);
  const [serverMemoItems, setServerMemoItems] = useState<BackedUpMemo[]>([]);
  const [serverMemoStatus, setServerMemoStatus] = useState(SERVER_MEMO_INITIAL_STATUS);

  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistErrorRef = useRef<unknown | null>(null);
  const syncServicesRef = useRef<SyncServices | null>(null);
  const jsonImportInputRef = useRef<HTMLInputElement | null>(null);

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
  const hasFirebaseConfigSet = useMemo(
    () => hasFirebaseConfig(firebaseClientEnv),
    [firebaseClientEnv]
  );
  const [servicesAvailableState, setServicesAvailableState] = useState(hasFirebaseConfigSet);
  const isServerReady = servicesAvailableState && syncServicesInitialized;

  useEffect(() => {
    syncServicesRef.current = null;
    setSyncServicesInitialized(false);
    setServicesAvailableState(hasFirebaseConfigSet);
    setUser(null);
  }, [firebaseClientEnv, hasFirebaseConfigSet]);

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

  const requireServerMemoSession = useCallback((): { user: WebPreviewUser; services: SyncServices } | null => {
    const services = ensureSyncServices();
    if (!user || !services) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      return null;
    }

    return {
      user,
      services,
    };
  }, [ensureSyncServices, user]);

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

      void completeGoogleRedirectSignIn(services.auth)
        .then((nextUser) => {
          if (!isMounted || !nextUser) {
            return;
          }
          setUser(normalizePreviewUser(nextUser));
          setBackupStatus(
            `${nextUser.displayName || nextUser.email || "사용자"}님이 로그인했습니다.`
          );
        })
        .then(async () => {
          const settledUser = await waitForSignedInUser(services.auth, 4000);
          if (!isMounted || !settledUser) {
            return;
          }
          setUser(normalizePreviewUser(settledUser));
          setBackupStatus(
            `${settledUser.displayName || settledUser.email || "사용자"}님이 로그인했습니다.`
          );
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

  const visibleMemos = useMemo(
    () => memos.filter((memo) => memo.deletedAt === null && memo.windowState.visible),
    [memos]
  );
  const managedMemos = useMemo(
    () => memos.filter((memo) => memo.deletedAt === null),
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

  const replaceMemosFromBackup = async (nextMemos: Memo[], previousMemos?: Memo[]) => {
    const currentMemos = previousMemos ?? (await repository.listMemos());
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

  const replaceMemosWithSafety = async (
    source: RestoreSafetyPoint["source"],
    userId: string,
    nextMemos: Memo[]
  ) => {
    if (!restoreSafetyStorage) {
      throw new Error("복원 안전 지점을 저장할 저장 공간을 사용할 수 없습니다.");
    }

    const currentMemos = await repository.listMemos();
    const safetyPoint = createRestoreSafetyPoint(source, userId, currentMemos);
    saveRestoreSafetyPoint(restoreSafetyStorage, safetyPoint);
    await replaceMemosFromBackup(nextMemos, currentMemos);
    setRestoreSafetyPoint(safetyPoint);
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

  const handleCloseMemo = async (memoId: string) => {
    const target = memos.find((memo) => memo.id === memoId);
    if (!target) {
      return;
    }

    const now = new Date().toISOString();
    const nextMemo: Memo = {
      ...target,
      updatedAt: now,
      syncState: "queued",
      windowState: {
        ...target.windowState,
        visible: false,
      },
    };

    try {
      await persistMemo(nextMemo);
    } catch (error) {
      setBackupStatus(`메모창 닫기 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleOpenMemo = async (memoId: string) => {
    const target = memos.find((memo) => memo.id === memoId);
    if (!target) {
      return;
    }

    const now = new Date().toISOString();
    const nextMemo: Memo = {
      ...target,
      deletedAt: null,
      updatedAt: now,
      syncState: "queued",
      windowState: {
        ...target.windowState,
        visible: true,
      },
    };

    try {
      await persistMemo(nextMemo);
    } catch (error) {
      setBackupStatus(`메모 열기 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleGenerateTextPreview = async () => {
    const contents = formatMemosAsCombinedText(memos);
    if (contents === "") {
      setBackupStatus("내보낼 메모가 없습니다.");
      return;
    }

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

  const downloadJsonBackup = (contents: string) => {
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "h-memo-backup.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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

    await waitForPendingPersists();
    await replaceMemosWithSafety("json", user?.uid ?? "local", parsed.payload.memos);
    setBackupStatus(`JSON 복원 완료: ${parsed.payload.memos.length}개 메모`);
  };

  const handleUndoRestore = async () => {
    const safetyPoint = restoreSafetyPoint;
    if (!safetyPoint || isBusy) {
      return;
    }
    if (!restoreSafetyStorage) {
      setBackupStatus("복원 되돌리기 실패: 안전 지점 저장 공간을 사용할 수 없습니다.");
      return;
    }

    setIsBusy(true);
    setBackupStatus("마지막 복원을 되돌리는 중입니다.");
    try {
      await waitForPendingPersists();
      await replaceMemosFromBackup(safetyPoint.payload.memos);
      clearRestoreSafetyPoint(restoreSafetyStorage);
      setRestoreSafetyPoint(null);
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
      downloadJsonBackup(contents);
      setBackupStatus("JSON 백업 파일을 만들었습니다.");
    } catch (error) {
      setBackupStatus(`JSON 백업 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportJsonBackup = () => {
    if (isBusy) {
      return;
    }
    jsonImportInputRef.current?.click();
  };

  const handleJsonImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || isBusy) {
      return;
    }

    setIsBusy(true);
    try {
      await restoreLocalBackupJson(await readTextFile(file));
    } catch (error) {
      setBackupStatus(`JSON 복원 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
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
    setBackupStatus("구글 로그인 중...");
    try {
      const nextUser = await signInWithGoogle(services.auth, {
        fallbackToRedirect: true,
      });
      if (!nextUser) {
        setBackupStatus("구글 로그인 완료를 확인하는 중입니다...");
        const settledUser = await waitForSignedInUser(services.auth, 8000);
        if (settledUser) {
          setUser(normalizePreviewUser(settledUser));
          setBackupStatus(`${settledUser.displayName || settledUser.email || "사용자"}님이 로그인했습니다.`);
          return;
        }
        setBackupStatus("구글 로그인 화면을 완료한 뒤 앱으로 돌아와 주세요.");
        return;
      }
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

  const applyFirebaseConfigState = (nextStoredConfig: Partial<typeof storedFirebaseClientEnv>) => {
    const nextEnv = mergeFirebaseClientConfig(buildFirebaseClientEnv, nextStoredConfig);
    const validation = validateFirebaseClientEnv(nextEnv);

    syncServicesRef.current = null;
    setSyncServicesInitialized(false);
    setServicesAvailableState(validation.isValid);
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
    setBackupStatus("백업 기록을 불러옵니다.");
    try {
      await waitForPendingPersists();
      const snapshots = await listBackupSnapshots(services.gateway, user.uid);
      if (snapshots.length === 0) {
        setBackupStatus(NO_BACKUP_MESSAGE);
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
    if (!snapshot || isBusy) {
      return;
    }

    setIsBusy(true);
    setBackupStatus("선택한 백업을 복원합니다.");
    try {
      await waitForPendingPersists();
      if (!window.confirm(getServerRestoreConfirmMessage(snapshot))) {
        setBackupStatus("복원을 취소했습니다.");
        return;
      }
      await replaceMemosWithSafety("server", user?.uid ?? "local", snapshot.payload.memos);
      setBackupHistoryDialog({ isOpen: false, snapshots: [] });
      setBackupStatus(`복원 완료: ${snapshot.payload.memos.length}개 메모`);
    } catch (error) {
      setBackupStatus(`${RESTORE_FAILED_PREFIX} ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const refreshServerMemos = async () => {
    const services = ensureSyncServices();
    if (!services) {
      const message = hasFirebaseConfigSet
        ? `${FIREBASE_INIT_FAILED_PREFIX} 구성 값을 확인해 주세요.`
        : FIREBASE_UNAVAILABLE_MESSAGE;
      setBackupStatus(message);
      setServerMemoItems([]);
      setServerMemoStatus(message);
      return;
    }

    if (!user) {
      setBackupStatus(LOGIN_REQUIRED_MESSAGE);
      setServerMemoItems([]);
      setServerMemoStatus(LOGIN_REQUIRED_MESSAGE);
      return;
    }

    if (isBusy) {
      return;
    }

    setIsBusy(true);
    setServerMemoStatus("서버 메모를 불러오는 중입니다.");
    try {
      const backedUpMemos = await listBackedUpMemos(services.gateway, user.uid);
      setServerMemoItems(backedUpMemos);
      setServerMemoStatus(
        backedUpMemos.length > 0
          ? `서버 메모 ${backedUpMemos.length}개를 불러왔습니다.`
          : "서버에 저장된 메모가 없습니다."
      );
    } catch (error) {
      const message = `서버 메모 목록 불러오기 실패: ${getErrorMessage(error)}`;
      setBackupStatus(message);
      setServerMemoStatus(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenServerMemoManager = async () => {
    setServerMemoManagerOpen(true);
    await refreshServerMemos();
  };

  const handleRestoreServerMemo = async (memoId: string) => {
    const backedUpMemo = serverMemoItems.find((item) => item.memo.id === memoId);
    if (!backedUpMemo || isBusy) {
      if (!backedUpMemo) {
        setBackupStatus("복원할 서버 메모를 찾지 못했습니다.");
        setServerMemoStatus("복원할 서버 메모를 찾지 못했습니다.");
      }
      return;
    }

    setIsBusy(true);
    const now = new Date().toISOString();
    const restoredMemo: Memo = {
      ...backedUpMemo.memo,
      deletedAt: null,
      updatedAt: now,
      syncState: "backed-up",
      windowState: {
        ...backedUpMemo.memo.windowState,
        visible: true,
      },
    };
    try {
      const savedMemo = await repository.saveMemo(restoredMemo);
      upsertMemo(savedMemo);
      setBackupStatus("서버 메모 복원 완료");
      setServerMemoStatus("서버 메모 복원 완료");
    } catch (error) {
      setBackupStatus(`서버 메모 복원 실패: ${getErrorMessage(error)}`);
      setServerMemoStatus(`서버 메모 복원 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteServerMemo = async (memoId: string) => {
    const session = requireServerMemoSession();
    if (!session || isBusy) {
      return;
    }

    setIsBusy(true);
    try {
      const deletedServerRecordCount = await deleteBackedUpMemo(
        session.services.gateway,
        session.user.uid,
        memoId
      );
      void deletedServerRecordCount;
      setServerMemoItems((previous) => previous.filter((item) => item.memo.id !== memoId));
      setBackupStatus("서버 메모를 삭제했습니다.");
      setServerMemoStatus("서버 메모를 삭제했습니다.");
    } catch (error) {
      const message = `서버 메모 삭제 실패: ${getErrorMessage(error)}`;
      setBackupStatus(message);
      setServerMemoStatus(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggleStartup = async (enabled: boolean) => {
    setStartupEnabled(enabled);
  };

  const isBackupDisabled = !isServerReady || user === null || isBusy;
  const isRestoreDisabled = !isServerReady || user === null || isBusy;
  const isAuthDisabled = !isServerReady || isBusy;

  return (
    <>
      <MemoWorkspace
        appClassName="web-app"
        title="H Memo"
        memos={visibleMemos}
        managedMemos={managedMemos}
        onCreateMemo={handleCreateMemo}
        onOpenMemo={handleOpenMemo}
        onMemoChange={handleMemoChange}
        onDeleteMemo={handleDeleteMemo}
        onCloseMemo={handleCloseMemo}
        actions={
          <button
            type="button"
            disabled={isBusy}
            onClick={handleOpenServerMemoManager}
          >
            서버 메모 관리
          </button>
        }
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
          isServerAvailable: isServerReady,
          isServerBusy: isBusy,
          isBackupDisabled,
          isRestoreDisabled,
          canUndoRestore: restoreSafetyPoint !== null,
          onUndoRestore: handleUndoRestore,
          isAuthDisabled,
          isStartupAvailable: false,
          showStartupSection: false,
        }}
      />
      <input
        ref={jsonImportInputRef}
        aria-label="JSON 백업 파일 선택"
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={handleJsonImportFileChange}
      />
      <ServerMemoManagerDialog
        isOpen={serverMemoManagerOpen}
        isBusy={isBusy}
        items={serverMemoItems}
        status={serverMemoStatus}
        onClose={() => setServerMemoManagerOpen(false)}
        onRefresh={refreshServerMemos}
        onRestore={handleRestoreServerMemo}
        onDelete={handleDeleteServerMemo}
      />
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
                        disabled={isBusy}
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
    </>
  );
}
