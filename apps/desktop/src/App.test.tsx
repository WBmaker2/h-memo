import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createMemo } from "@h-memo/memo-core";

const RESTORE_SAFETY_KEY = "h-memo:restore-safety-v1";

const {
  MockTauriMemoRepository,
  mockExportTextFile,
  mockExportJsonFile,
  mockImportJsonFile,
  mockGetStartupEnabled,
  mockSetStartupEnabled,
  mockSignInWithGoogle,
  mockSignOutUser,
  mockSaveMemo,
  mockSoftDeleteMemo,
  mockRestoreMemo,
  mockGetFirebaseClientEnv,
  defaultSaveMemo,
  defaultSoftDeleteMemo,
  defaultRestoreMemo,
  mockBackupMemos,
  mockRestoreLatestBackup,
  mockListBackupSnapshots,
  mockListBackedUpMemos,
  mockDeleteBackedUpMemo,
  mockCompleteGoogleRedirectSignIn,
  mockWaitForSignedInUser,
  mockGetFirestore,
  mockCreateFirebaseApp,
  mockGetFirebaseAuth,
  mockSubscribeAuthUser,
  mockAuthUnsubscribe,
  mockStartWindowDrag,
  mockStartWindowResize,
  mockCloseWindow,
  mockCloseMemoWindow,
  mockOpenMemoWindow,
  mockClaimCurrentMemoWindow,
  mockReleaseCurrentMemoWindow,
  mockReadWindowBounds,
  mockRestoreWindowBounds,
  mockSetWindowHeight,
  mockListenWindowBoundsChanged,
  mockNotifyMemoStoreChanged,
  mockNotifyAuthStateChanged,
  mockNotifyStartupStateChanged,
  mockNotifyRestoreLockRequested,
  mockNotifyRestoreLockAcknowledged,
  mockNotifyRestoreLockReleased,
  mockNotifyRestoreSafetyChanged,
  mockInvoke,
  mockGetCurrentWindowLabel,
  mockListLiveWindowLabels,
  mockStartGoogleDesktopOAuth,
  tauriRepositoryState,
  tauriWindowState,
  tauriEventState,
  nativeLeaseState,
} = vi.hoisted(() => {
  const mockExportTextFile = vi.fn();
  const mockExportJsonFile = vi.fn();
  const mockImportJsonFile = vi.fn();
  const mockGetStartupEnabled = vi.fn();
  const mockSetStartupEnabled = vi.fn();
  const mockSignInWithGoogle = vi.fn();
  const mockSignOutUser = vi.fn();
  const mockSaveMemo = vi.fn();
  const mockSoftDeleteMemo = vi.fn();
  const mockRestoreMemo = vi.fn();
  const mockBackupMemos = vi.fn();
  const mockRestoreLatestBackup = vi.fn();
  const mockListBackupSnapshots = vi.fn();
  const mockListBackedUpMemos = vi.fn();
  const mockDeleteBackedUpMemo = vi.fn();
  const mockCompleteGoogleRedirectSignIn = vi.fn();
  const mockWaitForSignedInUser = vi.fn();
  const mockStartWindowDrag = vi.fn();
  const mockStartWindowResize = vi.fn();
  const mockCloseWindow = vi.fn();
  const mockCloseMemoWindow = vi.fn();
  const mockOpenMemoWindow = vi.fn();
  const mockClaimCurrentMemoWindow = vi.fn();
  const mockReleaseCurrentMemoWindow = vi.fn();
  const mockRestoreWindowBounds = vi.fn();
  const mockSetWindowHeight = vi.fn();
  const mockListenWindowBoundsChanged = vi.fn();
  const mockNotifyMemoStoreChanged = vi.fn();
  const mockNotifyAuthStateChanged = vi.fn();
  const mockNotifyStartupStateChanged = vi.fn();
  const mockNotifyRestoreLockRequested = vi.fn();
  const mockNotifyRestoreLockAcknowledged = vi.fn();
  const mockNotifyRestoreLockReleased = vi.fn();
  const mockNotifyRestoreSafetyChanged = vi.fn();
  const mockInvoke = vi.fn();
  const mockGetCurrentWindowLabel = vi.fn();
  const mockListLiveWindowLabels = vi.fn();
  const mockStartGoogleDesktopOAuth = vi.fn();
  const tauriEventState: {
    memoStoreListener: ((payload: { memoId?: string; deletedMemoId?: string }) => void) | null;
    trayOpenAllMemosListener: (() => void | Promise<void>) | null;
    trayCreateMemoListener: (() => void | Promise<void>) | null;
    startupStateListener: ((payload: { enabled: boolean }) => void) | null;
    authStateListener:
      | ((payload: {
          user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null } | null;
          status: string;
        }) => void)
      | null;
    restoreLockRequestedListener: ((payload: { token: string }) => void | Promise<void>) | null;
    restoreLockAcknowledgedListener:
      | ((payload: { token: string; windowLabel: string; ok: boolean; error?: string }) => void)
      | null;
    restoreLockReleasedListener: ((payload: { token: string }) => void) | null;
    restoreSafetyChangedListener: (() => void) | null;
    unlistenMemoStore: ReturnType<typeof vi.fn>;
    unlistenTrayOpenAllMemos: ReturnType<typeof vi.fn>;
    unlistenTrayCreateMemo: ReturnType<typeof vi.fn>;
    unlistenStartupState: ReturnType<typeof vi.fn>;
    unlistenAuthState: ReturnType<typeof vi.fn>;
  } = {
    memoStoreListener: null,
    trayOpenAllMemosListener: null,
    trayCreateMemoListener: null,
    startupStateListener: null,
    authStateListener: null,
    restoreLockRequestedListener: null,
    restoreLockAcknowledgedListener: null,
    restoreLockReleasedListener: null,
    restoreSafetyChangedListener: null,
    unlistenMemoStore: vi.fn(),
    unlistenTrayOpenAllMemos: vi.fn(),
    unlistenTrayCreateMemo: vi.fn(),
    unlistenStartupState: vi.fn(),
    unlistenAuthState: vi.fn(),
  };
  const tauriWindowState: {
    bounds: { x: number; y: number; width: number; height: number };
    boundsListener: (() => void) | null;
    unlisten: ReturnType<typeof vi.fn>;
  } = {
    bounds: { x: 20, y: 30, width: 380, height: 420 },
    boundsListener: null,
    unlisten: vi.fn(),
  };
  const mockReadWindowBounds = vi.fn(async () => tauriWindowState.bounds);
  const mockGetFirestore = vi.fn((_app: unknown) => ({
    isMockFirestore: true,
  })) as Mock<(app: unknown) => { isMockFirestore: true }>;
  const mockCreateFirebaseApp = vi.fn((_env: unknown) => ({
    isMockFirebaseApp: true,
  })) as Mock<(env: unknown) => { isMockFirebaseApp: true }>;
  const mockGetFirebaseAuth = vi.fn((_app: unknown) => ({
    isMockFirebaseAuth: true,
  })) as Mock<(app: unknown) => { isMockFirebaseAuth: true }>;
  const mockAuthUnsubscribe = vi.fn();
  const mockSubscribeAuthUser = vi.fn((_auth: unknown, callback: (user: unknown) => void) => {
    return mockAuthUnsubscribe;
  }) as Mock<(auth: unknown, callback: (user: unknown) => void) => typeof mockAuthUnsubscribe>;
  const mockGetFirebaseClientEnv = vi.fn(() => ({
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
    storageBucket: "",
    messagingSenderId: "",
    measurementId: "",
    googleOAuthClientId: "",
  }));

  const tauriRepositoryState = new Map<string, any>();
  const nativeLeaseState: {
    lease: {
      token: string;
      owner: string;
      expiresAtMs: number;
      operationActive: boolean;
    } | null;
  } = {
    lease: null,
  };

  const cloneMemo = (value: any) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  };

  const listMemos = async () => {
    return [...tauriRepositoryState.values()].map(cloneMemo);
  };

  const defaultSaveMemo = async (nextMemo: any) => {
    tauriRepositoryState.set(nextMemo.id, cloneMemo(nextMemo));
    return cloneMemo(nextMemo);
  };

  const defaultSoftDeleteMemo = async (id: string, deletedAt: string) => {
    const current = tauriRepositoryState.get(id);
    if (!current) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    tauriRepositoryState.set(id, cloneMemo(next));
    return cloneMemo(next);
  };

  const defaultRestoreMemo = async (id: string, restoredAt: string) => {
    const current = tauriRepositoryState.get(id);
    if (!current) {
      throw new Error(`Cannot restore memo: memo not found (${id})`);
    }
    const next = {
      ...current,
      deletedAt: null,
      updatedAt: restoredAt,
      syncState: "queued",
      windowState: {
        ...current.windowState,
        visible: true,
      },
    };
    tauriRepositoryState.set(id, cloneMemo(next));
    return cloneMemo(next);
  };

  class MockTauriMemoRepository {
    listMemos = listMemos;
    saveMemo = mockSaveMemo;
    softDeleteMemo = mockSoftDeleteMemo;
    restoreMemo = mockRestoreMemo;
    async withRestoreToken<T>(_token: string, operation: () => Promise<T>) {
      return operation();
    }
  }

  return {
    mockExportTextFile,
    mockExportJsonFile,
    mockImportJsonFile,
    mockGetStartupEnabled,
    mockSetStartupEnabled,
    mockSignInWithGoogle,
    mockSignOutUser,
    mockSaveMemo,
    mockSoftDeleteMemo,
    mockRestoreMemo,
    defaultSaveMemo,
    defaultSoftDeleteMemo,
    defaultRestoreMemo,
    mockGetFirebaseClientEnv,
    mockBackupMemos,
    mockRestoreLatestBackup,
    mockListBackupSnapshots,
    mockListBackedUpMemos,
    mockDeleteBackedUpMemo,
    mockCompleteGoogleRedirectSignIn,
    mockWaitForSignedInUser,
    mockGetFirestore,
    mockCreateFirebaseApp,
    mockGetFirebaseAuth,
    mockSubscribeAuthUser,
    mockAuthUnsubscribe,
    mockStartWindowDrag,
    mockStartWindowResize,
    mockCloseWindow,
    mockCloseMemoWindow,
    mockOpenMemoWindow,
    mockClaimCurrentMemoWindow,
    mockReleaseCurrentMemoWindow,
    mockReadWindowBounds,
    mockRestoreWindowBounds,
    mockSetWindowHeight,
    mockListenWindowBoundsChanged,
    mockNotifyMemoStoreChanged,
    mockNotifyAuthStateChanged,
    mockNotifyStartupStateChanged,
    mockNotifyRestoreLockRequested,
    mockNotifyRestoreLockAcknowledged,
    mockNotifyRestoreLockReleased,
    mockNotifyRestoreSafetyChanged,
    mockInvoke,
    mockGetCurrentWindowLabel,
    mockListLiveWindowLabels,
    mockStartGoogleDesktopOAuth,
    tauriRepositoryState,
    tauriWindowState,
    tauriEventState,
    nativeLeaseState,
    MockTauriMemoRepository,
  };
});

function setMockFirebaseClientEnv(value: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  googleOAuthClientId?: string;
}) {
  mockGetFirebaseClientEnv.mockReturnValue({
    apiKey: value.apiKey,
    authDomain: value.authDomain,
    projectId: value.projectId,
    appId: value.appId,
    storageBucket: value.storageBucket ?? "",
    messagingSenderId: value.messagingSenderId ?? "",
    measurementId: value.measurementId ?? "",
    googleOAuthClientId:
      value.googleOAuthClientId ?? "desktop-client.apps.googleusercontent.com",
  });
}

vi.mock("./env/firebaseEnv", () => ({
  getFirebaseClientEnv: () => mockGetFirebaseClientEnv(),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: (app: unknown) => mockGetFirestore(app),
}));

vi.mock("@h-memo/memo-sync", () => {
  return {
    FirestoreBackupGateway: class {
      saveBackup = vi.fn();
      loadLatestBackup = vi.fn();
      loadBackups = vi.fn();
      deleteMemoFromBackups = vi.fn();
    },
    backupMemos: (gateway: unknown, userId: string, memos: unknown[]) =>
      mockBackupMemos(gateway, userId, memos),
    createFirebaseApp: (env: unknown) => mockCreateFirebaseApp(env),
    getFirebaseAuth: (app: unknown) => mockGetFirebaseAuth(app),
    hasFirebaseConfig: (env: Record<string, unknown>) =>
      typeof env.apiKey === "string" &&
      env.apiKey.trim() !== "" &&
      typeof env.authDomain === "string" &&
      env.authDomain.trim() !== "" &&
      typeof env.projectId === "string" &&
      env.projectId.trim() !== "" &&
      typeof env.appId === "string" &&
      env.appId.trim() !== "",
    restoreLatestBackup: (gateway: unknown, userId: string) =>
      mockRestoreLatestBackup(gateway, userId),
    listBackupSnapshots: (gateway: unknown, userId: string) =>
      mockListBackupSnapshots(gateway, userId),
    listBackedUpMemos: (gateway: unknown, userId: string) =>
      mockListBackedUpMemos(gateway, userId),
    deleteBackedUpMemo: (gateway: unknown, userId: string, memoId: string) =>
      mockDeleteBackedUpMemo(gateway, userId, memoId),
    completeGoogleRedirectSignIn: (auth: unknown) => mockCompleteGoogleRedirectSignIn(auth),
    waitForSignedInUser: (auth: unknown, timeoutMs?: number, intervalMs?: number) =>
      mockWaitForSignedInUser(auth, timeoutMs, intervalMs),
    subscribeAuthUser: (auth: unknown, callback: (user: unknown) => void) =>
      mockSubscribeAuthUser(auth, callback),
    signInWithGoogle: (auth: unknown, options?: unknown) => mockSignInWithGoogle(auth, options),
    signOutUser: (auth: unknown) => mockSignOutUser(auth),
  };
});

vi.mock("./adapters/tauriPlatform", () => ({
  exportTextFile: (...args: Parameters<typeof mockExportTextFile>) =>
    mockExportTextFile(...args),
  exportJsonFile: (...args: Parameters<typeof mockExportJsonFile>) =>
    mockExportJsonFile(...args),
  importJsonFile: () => mockImportJsonFile(),
  getStartupEnabled: () => mockGetStartupEnabled(),
  setStartupEnabled: (enabled: boolean) => mockSetStartupEnabled(enabled),
}));

vi.mock("./adapters/tauriMemoRepository", () => ({
  TauriMemoRepository: MockTauriMemoRepository,
}));

vi.mock("./adapters/tauriWindow", () => ({
  startWindowDrag: () => mockStartWindowDrag(),
  startWindowResize: (direction: "SouthEast") => mockStartWindowResize(direction),
  closeWindow: () => mockCloseWindow(),
  closeMemoWindow: (memoId: string) => mockCloseMemoWindow(memoId),
  openMemoWindow: (memo: unknown) => mockOpenMemoWindow(memo),
  claimCurrentMemoWindow: (memoId: string) => mockClaimCurrentMemoWindow(memoId),
  releaseCurrentMemoWindow: (memoId: string, claimToken: string) =>
    mockReleaseCurrentMemoWindow(memoId, claimToken),
  readWindowBounds: () => mockReadWindowBounds(),
  restoreWindowBounds: (bounds: unknown) => mockRestoreWindowBounds(bounds),
  setWindowHeight: (height: number) => mockSetWindowHeight(height),
  getCurrentWindowLabel: () => mockGetCurrentWindowLabel(),
  listLiveMemoWindowLabels: () => mockListLiveWindowLabels(),
  listenWindowBoundsChanged: (listener: () => void) => {
    tauriWindowState.boundsListener = listener;
    return mockListenWindowBoundsChanged(listener);
  },
}));

vi.mock("./adapters/tauriEvents", () => ({
  notifyMemoStoreChanged: (payload: unknown) => mockNotifyMemoStoreChanged(payload),
  notifyAuthStateChanged: (payload: unknown) => mockNotifyAuthStateChanged(payload),
  notifyStartupStateChanged: (payload: unknown) => mockNotifyStartupStateChanged(payload),
  notifyRestoreLockRequested: (token: string) => mockNotifyRestoreLockRequested(token),
  notifyRestoreLockAcknowledged: (payload: unknown) =>
    mockNotifyRestoreLockAcknowledged(payload),
  notifyRestoreLockReleased: (token: string) => mockNotifyRestoreLockReleased(token),
  notifyRestoreSafetyChanged: () => mockNotifyRestoreSafetyChanged(),
  listenMemoStoreChanged: async (
    listener: (payload: { memoId?: string; deletedMemoId?: string }) => void
  ) => {
    tauriEventState.memoStoreListener = listener;
    return tauriEventState.unlistenMemoStore;
  },
  listenTrayOpenAllMemos: async (listener: () => void | Promise<void>) => {
    tauriEventState.trayOpenAllMemosListener = listener;
    return tauriEventState.unlistenTrayOpenAllMemos;
  },
  listenTrayCreateMemo: async (listener: () => void | Promise<void>) => {
    tauriEventState.trayCreateMemoListener = listener;
    return tauriEventState.unlistenTrayCreateMemo;
  },
  listenAuthStateChanged: async (
    listener: (payload: {
      user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null } | null;
      status: string;
    }) => void
  ) => {
    tauriEventState.authStateListener = listener;
    return tauriEventState.unlistenAuthState;
  },
  listenStartupStateChanged: async (listener: (payload: { enabled: boolean }) => void) => {
    tauriEventState.startupStateListener = listener;
    return tauriEventState.unlistenStartupState;
  },
  listenRestoreLockRequested: async (listener: (payload: { token: string }) => void | Promise<void>) => {
    tauriEventState.restoreLockRequestedListener = listener;
    return vi.fn();
  },
  listenRestoreLockAcknowledged: async (
    listener: (payload: { token: string; windowLabel: string; ok: boolean; error?: string }) => void
  ) => {
    tauriEventState.restoreLockAcknowledgedListener = listener;
    return vi.fn();
  },
  listenRestoreLockReleased: async (listener: (payload: { token: string }) => void) => {
    tauriEventState.restoreLockReleasedListener = listener;
    return vi.fn();
  },
  listenRestoreSafetyChanged: async (listener: () => void) => {
    tauriEventState.restoreSafetyChangedListener = listener;
    return vi.fn();
  },
}));

vi.mock("./adapters/tauriGoogleOAuth", () => ({
  startGoogleDesktopOAuth: (clientId: string) => mockStartGoogleDesktopOAuth(clientId),
}));

import { App } from "./App";

type TestWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function setTauriRuntime(enabled: boolean) {
  const nextWindow = window as TestWindow;
  if (enabled) {
    nextWindow.__TAURI_INTERNALS__ = {};
  } else {
    delete nextWindow.__TAURI_INTERNALS__;
  }
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function getMemoFromTime({
  id = `memo-${Date.now()}`,
  now = new Date().toISOString(),
  title,
  text,
}: {
  id?: string;
  now?: string;
  title: string;
  text: string;
}) {
  return createMemo({
    id,
    now,
    title,
    plainText: text,
  });
}

function getStatus() {
  return screen.getByRole("status");
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  setTauriRuntime(false);
  window.localStorage.clear();
  tauriRepositoryState.clear();
  mockExportTextFile.mockReset();
  mockExportJsonFile.mockReset();
  mockImportJsonFile.mockReset();
  mockGetStartupEnabled.mockReset();
  mockSetStartupEnabled.mockReset();
  mockSignInWithGoogle.mockReset();
  mockSignOutUser.mockReset();
  mockSaveMemo.mockReset();
  mockSoftDeleteMemo.mockReset();
  mockRestoreMemo.mockReset();
  mockBackupMemos.mockReset();
  mockRestoreLatestBackup.mockReset();
  mockListBackupSnapshots.mockReset();
  mockListBackedUpMemos.mockReset();
  mockDeleteBackedUpMemo.mockReset();
  mockCompleteGoogleRedirectSignIn.mockReset();
  mockWaitForSignedInUser.mockReset();
  mockGetFirestore.mockReset();
  mockCreateFirebaseApp.mockReset();
  mockGetFirebaseAuth.mockReset();
  mockSubscribeAuthUser.mockReset();
  mockAuthUnsubscribe.mockReset();
  mockStartWindowDrag.mockReset();
  mockStartWindowResize.mockReset();
  mockCloseWindow.mockReset();
  mockCloseMemoWindow.mockReset();
  mockOpenMemoWindow.mockReset();
  mockClaimCurrentMemoWindow.mockReset();
  mockReleaseCurrentMemoWindow.mockReset();
  mockReadWindowBounds.mockReset();
  mockRestoreWindowBounds.mockReset();
  mockSetWindowHeight.mockReset();
  mockListenWindowBoundsChanged.mockReset();
  mockNotifyMemoStoreChanged.mockReset();
  mockNotifyAuthStateChanged.mockReset();
  mockNotifyStartupStateChanged.mockReset();
  mockNotifyRestoreLockRequested.mockReset();
  mockNotifyRestoreLockAcknowledged.mockReset();
  mockNotifyRestoreLockReleased.mockReset();
  mockNotifyRestoreSafetyChanged.mockReset();
  mockInvoke.mockReset();
  mockGetCurrentWindowLabel.mockReset();
  mockListLiveWindowLabels.mockReset();
  mockStartGoogleDesktopOAuth.mockReset();
  tauriWindowState.bounds = { x: 20, y: 30, width: 380, height: 420 };
  tauriWindowState.boundsListener = null;
  tauriWindowState.unlisten.mockReset();
  tauriEventState.memoStoreListener = null;
  tauriEventState.startupStateListener = null;
  tauriEventState.authStateListener = null;
  tauriEventState.restoreLockRequestedListener = null;
  tauriEventState.restoreLockAcknowledgedListener = null;
  tauriEventState.restoreLockReleasedListener = null;
  tauriEventState.restoreSafetyChangedListener = null;
  tauriEventState.unlistenMemoStore.mockReset();
  tauriEventState.unlistenStartupState.mockReset();
  tauriEventState.unlistenAuthState.mockReset();
  nativeLeaseState.lease = null;

  mockSaveMemo.mockImplementation((nextMemo: any) => defaultSaveMemo(nextMemo));
  mockSoftDeleteMemo.mockImplementation((id: string, deletedAt: string) =>
    defaultSoftDeleteMemo(id, deletedAt)
  );
  mockRestoreMemo.mockImplementation((id: string, restoredAt: string) =>
    defaultRestoreMemo(id, restoredAt)
  );

  mockGetFirestore.mockReturnValue({ isMockFirestore: true });
  mockCreateFirebaseApp.mockReturnValue({ isMockFirebaseApp: true });
  mockGetFirebaseAuth.mockReturnValue({ isMockFirebaseAuth: true });
  mockSubscribeAuthUser.mockImplementation((_, callback: (user: unknown) => void) => {
    callback(null);
    return mockAuthUnsubscribe;
  });
  mockStartWindowDrag.mockResolvedValue(undefined);
  mockStartWindowResize.mockResolvedValue(undefined);
  mockCloseWindow.mockResolvedValue(undefined);
  mockCloseMemoWindow.mockResolvedValue(undefined);
  mockOpenMemoWindow.mockResolvedValue(undefined);
  mockReadWindowBounds.mockImplementation(async () => tauriWindowState.bounds);
  mockClaimCurrentMemoWindow.mockResolvedValue({
    claimed: true,
    shouldCreate: false,
    windowLabel: "main",
    claimToken: "token-default",
  });
  mockReleaseCurrentMemoWindow.mockResolvedValue(undefined);
  mockRestoreWindowBounds.mockResolvedValue(undefined);
  mockSetWindowHeight.mockResolvedValue(undefined);
  mockListenWindowBoundsChanged.mockImplementation(async (listener: () => void) => {
    tauriWindowState.boundsListener = listener;
    return tauriWindowState.unlisten;
  });
  mockGetCurrentWindowLabel.mockReturnValue("main");
  mockListLiveWindowLabels.mockResolvedValue(["main"]);
  mockNotifyRestoreLockRequested.mockResolvedValue(undefined);
  mockNotifyRestoreLockAcknowledged.mockResolvedValue(undefined);
  mockNotifyRestoreLockReleased.mockResolvedValue(undefined);
  mockNotifyRestoreSafetyChanged.mockResolvedValue(undefined);
  mockInvoke.mockImplementation(async (command: string, args?: Record<string, any>) => {
    if (command === "current_restore_lock_lease") {
      if (
        nativeLeaseState.lease &&
        !nativeLeaseState.lease.operationActive &&
        nativeLeaseState.lease.expiresAtMs <= Date.now()
      ) {
        nativeLeaseState.lease = null;
      }
      return nativeLeaseState.lease;
    }
    if (command === "acquire_restore_lock_lease") {
      const token = String(args?.token ?? "");
      const owner = String(args?.owner ?? "");
      if (nativeLeaseState.lease && nativeLeaseState.lease.token !== token) {
        throw new Error("다른 복원 작업이 이미 진행 중입니다.");
      }
      nativeLeaseState.lease = {
        token,
        owner,
        expiresAtMs: Date.now() + Number(args?.ttlMs ?? 10_000),
        operationActive: false,
      };
      return nativeLeaseState.lease;
    }
    if (command === "renew_restore_lock_lease") {
      const token = String(args?.token ?? "");
      const owner = String(args?.owner ?? "");
      if (
        !nativeLeaseState.lease ||
        nativeLeaseState.lease.token !== token ||
        nativeLeaseState.lease.owner !== owner
      ) {
        throw new Error("복원 잠금 lease가 없습니다.");
      }
      nativeLeaseState.lease.expiresAtMs = Date.now() + Number(args?.ttlMs ?? 10_000);
      return nativeLeaseState.lease;
    }
    if (command === "activate_restore_lock_lease") {
      const token = String(args?.token ?? "");
      const owner = String(args?.owner ?? "");
      if (
        !nativeLeaseState.lease ||
        nativeLeaseState.lease.token !== token ||
        nativeLeaseState.lease.owner !== owner
      ) {
        throw new Error("복원 잠금 lease가 없습니다.");
      }
      nativeLeaseState.lease.operationActive = true;
      return nativeLeaseState.lease;
    }
    if (command === "release_restore_lock_lease") {
      const token = String(args?.token ?? "");
      const owner = String(args?.owner ?? "");
      if (
        nativeLeaseState.lease?.token === token &&
        nativeLeaseState.lease.owner === owner
      ) {
        nativeLeaseState.lease = null;
        return true;
      }
      return false;
    }
    return undefined;
  });
  tauriEventState.memoStoreListener = null;
  tauriEventState.trayOpenAllMemosListener = null;
  tauriEventState.trayCreateMemoListener = null;
  tauriEventState.startupStateListener = null;
  tauriEventState.authStateListener = null;
  tauriEventState.unlistenMemoStore.mockReset();
  tauriEventState.unlistenTrayOpenAllMemos.mockReset();
  tauriEventState.unlistenTrayCreateMemo.mockReset();
  tauriEventState.unlistenStartupState.mockReset();
  tauriEventState.unlistenAuthState.mockReset();
  mockExportTextFile.mockResolvedValue({ status: "saved", path: "/tmp/h-memo-backup.txt" });
  mockExportJsonFile.mockResolvedValue({ status: "saved", path: "/tmp/h-memo-backup.json" });
  mockImportJsonFile.mockResolvedValue({ status: "cancelled" });
  mockListBackupSnapshots.mockResolvedValue([]);
  mockListBackedUpMemos.mockResolvedValue([]);
  mockDeleteBackedUpMemo.mockResolvedValue(0);
  mockNotifyMemoStoreChanged.mockResolvedValue(undefined);
  mockNotifyAuthStateChanged.mockResolvedValue(undefined);
  mockNotifyStartupStateChanged.mockResolvedValue(undefined);
  mockCompleteGoogleRedirectSignIn.mockResolvedValue(null);
  mockWaitForSignedInUser.mockResolvedValue(null);
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:h-memo-backup"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });

  setMockFirebaseClientEnv({
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
  });
});

async function createMemoFromAppMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("앱 메뉴"));
  await user.click(screen.getByRole("button", { name: "새 메모" }));
  await screen.findByLabelText("메모 내용");
}

describe("desktop App", () => {
  it("exports memo body text without a separate title field", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "tray memo" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));

    expect(screen.queryByLabelText("메모 제목")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockExportTextFile).toHaveBeenCalledWith(
        "h-memo-backup.txt",
        expect.stringContaining("tray memo")
      );
    });
    expect(mockExportTextFile.mock.calls[0][1]).not.toMatch(/제목:/);
  });

  it("does not expose memo hide when there is no restore action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "윈도우메모" } });

    expect(screen.queryByRole("button", { name: "메모 숨기기" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("윈도우메모")).toBeInTheDocument();
  });

  it("opens a new desktop memo in an independent window", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "첫 번째 메모" },
    });
    await user.click(screen.getByRole("button", { name: "새 메모" }));

    expect(screen.getByDisplayValue("첫 번째 메모")).toBeInTheDocument();
    expect(screen.getAllByLabelText("메모 내용")).toHaveLength(1);
    await waitFor(() => {
      expect(mockOpenMemoWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          plainText: "",
        })
      );
    });
  });

  it("releases the previous active memo before claiming the replacement memo window", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const first = createMemo({
      id: "memo-first",
      now: "2026-07-11T09:00:00.000Z",
      plainText: "첫 번째 메모",
    });
    const second = createMemo({
      id: "memo-second",
      now: "2026-07-11T09:01:00.000Z",
      plainText: "두 번째 메모",
    });
    tauriRepositoryState.set(first.id, first);
    tauriRepositoryState.set(second.id, second);

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith("memo-first");
      expect(tauriEventState.memoStoreListener).toEqual(expect.any(Function));
    });

    tauriRepositoryState.set(first.id, {
      ...first,
      deletedAt: "2026-07-11T09:02:00.000Z",
    });
    await act(async () => {
      tauriEventState.memoStoreListener?.({ deletedMemoId: first.id });
    });

    await waitFor(() => {
      expect(mockReleaseCurrentMemoWindow).toHaveBeenCalledWith("memo-first", "token-default");
      expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith("memo-second");
    });

    unmount();

    await waitFor(() => {
      expect(mockReleaseCurrentMemoWindow).toHaveBeenCalledWith("memo-second", "token-default");
    });
  });

  it("reconciles memo-window ownership after a restore lock changes the active memo", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const first = createMemo({
      id: "memo-lock-first",
      now: "2026-07-11T09:00:00.000Z",
      plainText: "복원 전 메모",
    });
    const second = createMemo({
      id: "memo-lock-second",
      now: "2026-07-11T09:01:00.000Z",
      plainText: "복원 후 메모",
    });
    tauriRepositoryState.set(first.id, first);
    tauriRepositoryState.set(second.id, second);

    render(<App />);

    await waitFor(() => {
      expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith(first.id);
      expect(tauriEventState.restoreLockRequestedListener).toEqual(expect.any(Function));
    });

    nativeLeaseState.lease = {
      token: "remote-restore-lock",
      owner: "main",
      expiresAtMs: Date.now() + 10_000,
      operationActive: false,
    };
    await act(async () => {
      await tauriEventState.restoreLockRequestedListener?.({ token: "remote-restore-lock" });
    });
    await waitFor(() => {
      expect(mockNotifyRestoreLockAcknowledged).toHaveBeenCalledWith({
        token: "remote-restore-lock",
        windowLabel: "main",
        ok: true,
      });
    });

    tauriRepositoryState.set(first.id, {
      ...first,
      deletedAt: "2026-07-11T09:02:00.000Z",
    });
    await act(async () => {
      tauriEventState.memoStoreListener?.({ deletedMemoId: first.id });
    });
    await waitFor(() => expect(screen.queryByDisplayValue("복원 전 메모")).not.toBeInTheDocument());
    expect(mockReleaseCurrentMemoWindow).not.toHaveBeenCalledWith(first.id, "token-default");
    expect(mockClaimCurrentMemoWindow).not.toHaveBeenCalledWith(second.id);

    nativeLeaseState.lease = null;
    await act(async () => {
      tauriEventState.restoreLockReleasedListener?.({ token: "remote-restore-lock" });
    });

    await waitFor(() => {
      expect(mockReleaseCurrentMemoWindow).toHaveBeenCalledWith(first.id, "token-default");
      expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith(second.id);
      expect(screen.getByDisplayValue("복원 후 메모")).toBeInTheDocument();
    });
  });

  it("serializes rapid A to B to A ownership transitions by completion order", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memoA = createMemo({
      id: "memo-a",
      now: "2026-07-11T09:00:00.000Z",
      plainText: "A 메모",
    });
    const memoB = createMemo({
      id: "memo-b",
      now: "2026-07-11T09:01:00.000Z",
      plainText: "B 메모",
    });
    const firstClaim = deferred<{
      claimed: boolean;
      shouldCreate: boolean;
      windowLabel: string;
      claimToken: string | null;
    }>();
    const secondClaim = deferred<{
      claimed: boolean;
      shouldCreate: boolean;
      windowLabel: string;
      claimToken: string | null;
    }>();
    const finalClaim = deferred<{
      claimed: boolean;
      shouldCreate: boolean;
      windowLabel: string;
      claimToken: string | null;
    }>();
    const releaseA = deferred<void>();
    const releaseB = deferred<void>();
    let aClaims = 0;
    tauriRepositoryState.set(memoA.id, memoA);
    tauriRepositoryState.set(memoB.id, memoB);
    mockClaimCurrentMemoWindow.mockImplementation((memoId: string) => {
      if (memoId === memoA.id) {
        aClaims += 1;
        return aClaims === 1 ? firstClaim.promise : finalClaim.promise;
      }
      return secondClaim.promise;
    });
    mockReleaseCurrentMemoWindow.mockImplementation((memoId: string) => {
      if (memoId === memoA.id) {
        return releaseA.promise;
      }
      if (memoId === memoB.id) {
        return releaseB.promise;
      }
      return Promise.resolve();
    });

    render(<App />);

    await waitFor(() => expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith(memoA.id));
    firstClaim.resolve({
      claimed: true,
      shouldCreate: false,
      windowLabel: "main",
      claimToken: "token-a-1",
    });
    await waitFor(() => expect(screen.getByDisplayValue("A 메모")).toBeInTheDocument());

    tauriRepositoryState.set(memoA.id, { ...memoA, deletedAt: "2026-07-11T09:02:00.000Z" });
    await act(async () => {
      tauriEventState.memoStoreListener?.({ deletedMemoId: memoA.id });
    });
    await waitFor(() => {
      expect(mockReleaseCurrentMemoWindow).toHaveBeenCalledWith(memoA.id, "token-a-1");
    });
    expect(mockClaimCurrentMemoWindow).not.toHaveBeenCalledWith(memoB.id);

    releaseA.resolve();
    await waitFor(() => expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith(memoB.id));

    tauriRepositoryState.set(memoA.id, memoA);
    tauriRepositoryState.set(memoB.id, { ...memoB, deletedAt: "2026-07-11T09:03:00.000Z" });
    await act(async () => {
      tauriEventState.memoStoreListener?.({ deletedMemoId: memoB.id });
    });
    expect(mockClaimCurrentMemoWindow).toHaveBeenCalledTimes(2);

    secondClaim.resolve({
      claimed: true,
      shouldCreate: false,
      windowLabel: "main",
      claimToken: "token-b-1",
    });
    await waitFor(() => {
      expect(mockReleaseCurrentMemoWindow).toHaveBeenCalledWith(memoB.id, "token-b-1");
    });
    expect(mockClaimCurrentMemoWindow).toHaveBeenCalledTimes(2);

    releaseB.resolve();
    await waitFor(() => {
      expect(mockClaimCurrentMemoWindow).toHaveBeenCalledTimes(3);
      expect(mockClaimCurrentMemoWindow).toHaveBeenLastCalledWith(memoA.id);
    });
    finalClaim.resolve({
      claimed: true,
      shouldCreate: false,
      windowLabel: "main",
      claimToken: "token-a-2",
    });
  });

  it("renders no memo when the current window claim is rejected", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memo = createMemo({
      id: "memo-owned-elsewhere",
      now: "2026-07-11T09:00:00.000Z",
      plainText: "다른 창 소유 메모",
    });
    tauriRepositoryState.set(memo.id, memo);
    mockClaimCurrentMemoWindow.mockResolvedValue({
      claimed: false,
      shouldCreate: false,
      windowLabel: "memo_memo-owned-elsewhere",
      claimToken: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(mockClaimCurrentMemoWindow).toHaveBeenCalledWith(memo.id);
      expect(screen.queryByLabelText("메모 내용")).not.toBeInTheDocument();
    });
  });

  it("opens all stored desktop memos when the tray asks to open all memos", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const first = createMemo({
      id: "memo-first",
      now: "2026-05-16T09:00:00.000Z",
      plainText: "111",
    });
    const second = createMemo({
      id: "memo-second",
      now: "2026-05-16T09:01:00.000Z",
      plainText: "222",
    });
    const deleted = {
      ...createMemo({
        id: "memo-deleted",
        now: "2026-05-16T09:02:00.000Z",
        plainText: "삭제된 메모",
      }),
      deletedAt: "2026-05-16T09:03:00.000Z",
    };
    tauriRepositoryState.set(first.id, first);
    tauriRepositoryState.set(second.id, second);
    tauriRepositoryState.set(deleted.id, deleted);

    render(<App />);

    await waitFor(() => {
      expect(tauriEventState.trayOpenAllMemosListener).toEqual(expect.any(Function));
    });

    await act(async () => {
      await tauriEventState.trayOpenAllMemosListener?.();
    });

    await waitFor(() => {
      expect(mockOpenMemoWindow).toHaveBeenCalledWith(
        expect.objectContaining({ id: "memo-first" })
      );
    });
    expect(mockOpenMemoWindow).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "memo-deleted" })
    );
    expect(screen.getByRole("status")).toHaveTextContent("메모 2개를 열었습니다.");
  });

  it("creates a new independent memo when the tray asks to create a memo", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const existing = createMemo({
      id: "memo-existing",
      now: "2026-05-16T09:00:00.000Z",
      plainText: "기존 메모",
    });
    tauriRepositoryState.set(existing.id, existing);

    render(<App />);

    await waitFor(() => {
      expect(tauriEventState.trayCreateMemoListener).toEqual(expect.any(Function));
    });

    await act(async () => {
      await tauriEventState.trayCreateMemoListener?.();
    });

    await waitFor(() => {
      expect(mockOpenMemoWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          plainText: "",
          deletedAt: null,
        })
      );
    });
    expect(mockSaveMemo).toHaveBeenCalledWith(
      expect.objectContaining({
        plainText: "",
        deletedAt: null,
      })
    );
  });

  it("keeps browser fallback behavior for text export downloads", async () => {
    const user = userEvent.setup();
    const appendSpy = vi.spyOn(document.body, "append");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);

    expect(getStatus()).toHaveTextContent(
      "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다."
    );

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "browser text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("TXT 백업 파일을 만들었습니다.");
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();
    expect(mockExportTextFile).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    appendSpy.mockRestore();
  });

  it("displays tauri export cancelled message", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockExportTextFile.mockResolvedValue({ status: "cancelled" });

    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "cancel text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("TXT 저장을 취소했습니다.");
    });
  });

  it("displays tauri export failure message", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockExportTextFile.mockResolvedValue({
      status: "failed",
      message: "저장 경로 접근 오류",
    });

    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "fail text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("TXT 저장 실패: 저장 경로 접근 오류");
    });
  });

  it("exports all memos to a local JSON backup", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const first = createMemo({
      id: "memo-json-1",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "첫 JSON 메모",
    });
    const second = createMemo({
      id: "memo-json-2",
      now: "2026-05-13T09:01:00.000Z",
      plainText: "둘째 JSON 메모",
    });
    tauriRepositoryState.set(first.id, first);
    tauriRepositoryState.set(second.id, second);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("첫 JSON 메모")).toBeInTheDocument();
      expect(mockOpenMemoWindow).toHaveBeenCalledWith(
        expect.objectContaining({ id: "memo-json-2" })
      );
    });

    await user.click(screen.getAllByRole("button", { name: "JSON 백업" })[0]);

    await waitFor(() => {
      expect(mockExportJsonFile).toHaveBeenCalledWith(
        "h-memo-backup.json",
        expect.any(String)
      );
    });
    const payload = JSON.parse(mockExportJsonFile.mock.calls[0][1]);
    expect(payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual([
      "memo-json-1",
      "memo-json-2",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("JSON 백업 완료:");
  });

  it("restores memos from a local JSON backup", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const restoredMemo = createMemo({
      id: "memo-json-restored",
      now: "2026-05-13T09:02:00.000Z",
      plainText: "복원된 JSON 메모",
    });
    mockImportJsonFile.mockResolvedValue({
      status: "loaded",
      contents: JSON.stringify({
        version: 1,
        userId: "local",
        createdAt: "2026-05-13T09:03:00.000Z",
        memos: [restoredMemo],
      }),
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "JSON 복원" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("현재 메모를 대체합니다")
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("복원된 JSON 메모")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원 완료: 1개 메모");
    });
  });

  it("cancels local JSON restore before replacing current memos", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    vi.mocked(window.confirm).mockReturnValue(false);
    const currentMemo = createMemo({
      id: "memo-json-current",
      now: "2026-05-13T09:01:00.000Z",
      plainText: "현재 유지할 메모",
    });
    const restoredMemo = createMemo({
      id: "memo-json-cancelled",
      now: "2026-05-13T09:02:00.000Z",
      plainText: "취소된 복원 메모",
    });
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    mockImportJsonFile.mockResolvedValue({
      status: "loaded",
      contents: JSON.stringify({
        version: 1,
        userId: "local",
        createdAt: "2026-05-13T09:03:00.000Z",
        memos: [restoredMemo],
      }),
    });

    render(<App />);
    await waitFor(() => expect(screen.getByDisplayValue("현재 유지할 메모")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "JSON 복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원을 취소했습니다.");
    });
    expect(screen.getByDisplayValue("현재 유지할 메모")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("취소된 복원 메모")).not.toBeInTheDocument();
    expect(mockSoftDeleteMemo).not.toHaveBeenCalledWith(
      "memo-json-current",
      expect.any(String)
    );
  });

  it("persists every desktop memo before JSON restore and supports one-step undo", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const currentMemo = createMemo({
      id: "memo-json-current-with-undo",
      now: "2026-07-12T09:00:00.000Z",
      plainText: "복원 전 데스크톱 메모",
    });
    const deletedMemo = {
      ...createMemo({
        id: "memo-json-deleted-with-undo",
        now: "2026-07-12T09:01:00.000Z",
        plainText: "삭제된 데스크톱 메모",
      }),
      deletedAt: "2026-07-12T09:02:00.000Z",
      windowState: {
        ...currentMemo.windowState,
        visible: false,
      },
    };
    const restoredMemo = createMemo({
      id: "memo-json-restored-with-undo",
      now: "2026-07-12T09:03:00.000Z",
      plainText: "복원된 데스크톱 메모",
    });
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    tauriRepositoryState.set(deletedMemo.id, deletedMemo);
    mockImportJsonFile.mockResolvedValue({
      status: "loaded",
      contents: JSON.stringify({
        version: 1,
        userId: "local",
        createdAt: "2026-07-12T09:04:00.000Z",
        memos: [restoredMemo],
      }),
    });

    const safetyMutationOrder: string[] = [];
    const storage = window.localStorage;
    const originalRemoveItem = storage.removeItem.bind(storage);
    storage.removeItem = (key: string) => {
      if (key === RESTORE_SAFETY_KEY) {
        safetyMutationOrder.push("clear-safety");
      }
      originalRemoveItem(key);
    };
    mockNotifyRestoreLockReleased.mockImplementation(async () => {
      safetyMutationOrder.push("unlock");
    });

    let safetyAtFirstWrite: string | null = null;
    mockSaveMemo.mockImplementation(async (nextMemo: any) => {
      safetyAtFirstWrite ??= window.localStorage.getItem(RESTORE_SAFETY_KEY);
      return defaultSaveMemo(nextMemo);
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("복원 전 데스크톱 메모")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "JSON 복원" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("복원된 데스크톱 메모")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원 완료: 1개 메모");
    });

    const safetyPointBeforeUndo = JSON.parse(
      window.localStorage.getItem(RESTORE_SAFETY_KEY) ?? "null"
    );
    expect(safetyPointBeforeUndo.source).toBe("json");
    expect(safetyPointBeforeUndo.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      [currentMemo.id, deletedMemo.id].sort()
    );
    expect(safetyAtFirstWrite).toBeTruthy();

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    let safetyAtUndoWrite: string | null = null;
    mockSaveMemo.mockImplementation(async (nextMemo: any) => {
      if (nextMemo.id === currentMemo.id) {
        safetyAtUndoWrite = window.localStorage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSaveMemo(nextMemo);
    });

    await user.click(screen.getByRole("button", { name: "마지막 복원 되돌리기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("마지막 복원을 되돌렸습니다.");
      expect(screen.getByDisplayValue("복원 전 데스크톱 메모")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("복원된 데스크톱 메모")).not.toBeInTheDocument();
    expect(safetyAtUndoWrite).toEqual(JSON.stringify(safetyPointBeforeUndo));
    expect(window.localStorage.getItem(RESTORE_SAFETY_KEY)).toBeNull();
    expect(safetyMutationOrder.lastIndexOf("clear-safety")).toBeLessThan(
      safetyMutationOrder.lastIndexOf("unlock")
    );
    storage.removeItem = originalRemoveItem;
  });

  it("does not replace desktop memos when restore safety storage fails", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const currentMemo = createMemo({
      id: "memo-desktop-storage-failure-current",
      now: "2026-07-12T13:00:00.000Z",
      plainText: "저장 실패에도 유지할 데스크톱 메모",
    });
    const restoredMemo = createMemo({
      id: "memo-desktop-storage-failure-restored",
      now: "2026-07-12T13:01:00.000Z",
      plainText: "저장 실패로 복원되지 않을 데스크톱 메모",
    });
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    mockImportJsonFile.mockResolvedValue({
      status: "loaded",
      contents: JSON.stringify({
        version: 1,
        userId: "local",
        createdAt: "2026-07-12T13:02:00.000Z",
        memos: [restoredMemo],
      }),
    });

    const nativeStorage = window.localStorage;
    const failingStorage: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error("quota exceeded");
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: failingStorage,
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("저장 실패에도 유지할 데스크톱 메모")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "JSON 복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원 실패: 복원 안전 지점");
      expect(screen.getByDisplayValue("저장 실패에도 유지할 데스크톱 메모")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("저장 실패로 복원되지 않을 데스크톱 메모")).not.toBeInTheDocument();
    expect(mockSaveMemo).not.toHaveBeenCalledWith(restoredMemo);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: nativeStorage,
    });
  });

  it("loads startup state and handles failure", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockRejectedValue(new Error("fail"));

    render(<App />);

    const status = screen.getByRole("status");
    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
      expect(status).toHaveTextContent("시작프로그램 상태를 확인하지 못했습니다.");
    });
  });

  it("restores the saved memo window position and size on launch", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memo = createMemo({
      id: "memo-1",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "마지막 로컬 메모",
      windowState: {
        x: 111,
        y: 222,
        width: 430,
        height: 360,
      },
    });
    tauriRepositoryState.set(memo.id, memo);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("마지막 로컬 메모")).toBeInTheDocument();
      expect(mockRestoreWindowBounds).toHaveBeenCalledWith({
        x: 111,
        y: 222,
        width: 430,
        height: 360,
      });
    });
  });

  it("persists native window bounds after move or resize events", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memo = createMemo({
      id: "memo-1",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "위치 저장 메모",
    });
    tauriRepositoryState.set(memo.id, memo);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("위치 저장 메모")).toBeInTheDocument();
      expect(tauriWindowState.boundsListener).not.toBeNull();
    });

    vi.useFakeTimers();
    try {
      tauriWindowState.bounds = { x: 333, y: 444, width: 460, height: 390 };
      tauriWindowState.boundsListener?.();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(260);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(mockSaveMemo).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "memo-1",
          plainText: "위치 저장 메모",
          windowState: expect.objectContaining({
            x: 333,
            y: 444,
            width: 460,
            height: 390,
          }),
        })
      );
    });
  });

  it("wires the titlebar to Tauri drag, close control, and collapse resize", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memo = createMemo({
      id: "memo-1",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "창 제어 메모",
    });
    tauriRepositoryState.set(memo.id, memo);
    tauriWindowState.bounds = { x: 60, y: 70, width: 420, height: 360 };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("창 제어 메모")).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByLabelText("상단 메뉴바"), { button: 0 });
    expect(screen.queryByRole("button", { name: "최소화" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "최대화" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "종료" }));
    fireEvent.doubleClick(screen.getByLabelText("상단 메뉴바"));

    await waitFor(() => {
      expect(mockStartWindowDrag).toHaveBeenCalledTimes(1);
      expect(mockCloseWindow).toHaveBeenCalledTimes(1);
      expect(mockSetWindowHeight).toHaveBeenCalledWith(46);
    });
  });

  it("reverts startup state when tauri toggle fails", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockSetStartupEnabled.mockResolvedValue(false);

    render(<App />);
    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
    });

    mockSetStartupEnabled.mockRejectedValueOnce(new Error("fail"));
    await user.click(startupSwitch);

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
      expect(screen.getByRole("status")).toHaveTextContent("시작프로그램 설정을 변경하지 못했습니다.");
    });
  });

  it("broadcasts startup registration changes to other memo windows", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockSetStartupEnabled.mockResolvedValue(true);

    render(<App />);
    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
    });

    await user.click(startupSwitch);

    await waitFor(() => {
      expect(mockSetStartupEnabled).toHaveBeenCalledWith(true);
      expect(mockNotifyStartupStateChanged).toHaveBeenCalledWith({ enabled: true });
      expect(startupSwitch).toBeChecked();
    });
  });

  it("syncs startup registration state from another memo window", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);

    render(<App />);
    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });

    await waitFor(() => {
      expect(startupSwitch).not.toBeChecked();
      expect(tauriEventState.startupStateListener).not.toBeNull();
    });

    act(() => {
      tauriEventState.startupStateListener?.({ enabled: true });
    });

    expect(startupSwitch).toBeChecked();

    act(() => {
      tauriEventState.startupStateListener?.({ enabled: false });
    });

    expect(startupSwitch).not.toBeChecked();
  });

  it("excludes deleted memo from export", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const deletedMemo = {
      ...createMemo({
      id: "memo-delete-export",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "delete text",
      }),
      deletedAt: "2026-05-13T09:02:00.000Z",
      updatedAt: "2026-05-13T09:02:00.000Z",
    };
    const keepMemo = createMemo({
      id: "memo-keep-export",
      now: "2026-05-13T09:01:00.000Z",
      plainText: "keep text",
    });
    tauriRepositoryState.set(deletedMemo.id, deletedMemo);
    tauriRepositoryState.set(keepMemo.id, keepMemo);

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "delete text 삭제" })).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("keep text")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("TXT 저장 완료:");
    });
    expect(mockExportTextFile).toHaveBeenCalledWith(
      "h-memo-backup.txt",
      expect.stringContaining("keep text")
    );
    expect(mockExportTextFile.mock.calls[0]?.[1]).not.toContain("delete text");
  });

  it("blocks deletion when only one visible memo remains", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "마지막 메모" },
    });

    await user.click(screen.getByRole("button", { name: "마지막 메모 삭제" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("마지막 남은 메모는 삭제할 수 없습니다.");
    });
    expect(screen.queryByRole("dialog", { name: "메모 삭제" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("마지막 메모")).toBeInTheDocument();
  });

  it("backs up a memo before closing the window without deleting the local or server copy", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "user-1",
        displayName: "테스터",
        email: "test@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    mockBackupMemos.mockResolvedValue({
      path: "users/user-1/backups/1",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-13T09:00:00.000Z",
        memos: [],
      },
    });

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "삭제 후보" } });
    await user.click(screen.getByRole("button", { name: "새 메모" }));

    await user.click(screen.getByRole("button", { name: "삭제 후보 삭제" }));

    expect(screen.getByRole("dialog", { name: "메모 삭제" })).toHaveTextContent(
      "아직 백업되지 않는 내용이 있습니다. 정말 삭제하겠습니까?"
    );
    await user.click(screen.getByRole("button", { name: "지금 백업하기" }));

    await waitFor(() => {
      expect(mockBackupMemos).toHaveBeenCalledTimes(1);
      expect(mockSoftDeleteMemo).not.toHaveBeenCalled();
      expect(mockDeleteBackedUpMemo).not.toHaveBeenCalled();
      expect(mockCloseWindow).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("백업 후 메모창을 닫았습니다.");
    });
    expect(screen.getByRole("button", { name: "삭제 후보 열기" })).toBeInTheDocument();
  });

  it("backs up and closes the selected memo window instead of the current main window", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "user-1",
        displayName: "테스터",
        email: "test@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    mockBackupMemos.mockResolvedValue({
      path: "users/user-1/backups/1",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: "2026-05-16T09:04:00.000Z",
        memos: [],
      },
    });
    const activeMainMemo = createMemo({
      id: "memo-111",
      now: "2026-05-16T09:03:00.000Z",
      plainText: "111",
    });
    const otherMemo = createMemo({
      id: "memo-222",
      now: "2026-05-16T09:02:00.000Z",
      plainText: "222",
    });
    const selectedMemo = createMemo({
      id: "memo-3333",
      now: "2026-05-16T09:01:00.000Z",
      plainText: "3333",
    });
    tauriRepositoryState.set(activeMainMemo.id, activeMainMemo);
    tauriRepositoryState.set(otherMemo.id, otherMemo);
    tauriRepositoryState.set(selectedMemo.id, selectedMemo);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("111")).toBeInTheDocument();
    });
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "3333 삭제" }));
    await user.click(screen.getByRole("button", { name: "지금 백업하기" }));

    await waitFor(() => {
      expect(mockBackupMemos).toHaveBeenCalledTimes(1);
      expect(mockCloseMemoWindow).toHaveBeenCalledWith("memo-3333");
      expect(mockCloseWindow).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("백업 후 메모창을 닫았습니다.");
    });
  });

  it("deletes a memo locally and from the server when delete is confirmed", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "user-1",
        displayName: "테스터",
        email: "test@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    mockDeleteBackedUpMemo.mockResolvedValue(1);

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "완전 삭제 후보" } });
    await user.click(screen.getByRole("button", { name: "새 메모" }));

    await user.click(screen.getByRole("button", { name: "완전 삭제 후보 삭제" }));
    await user.click(screen.getByRole("button", { name: "삭제하기" }));

    await waitFor(() => {
      expect(mockDeleteBackedUpMemo).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.stringMatching(/^memo-/)
      );
      expect(mockSoftDeleteMemo).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent(
        "로컬과 서버에서 메모를 삭제했습니다."
      );
    });
  });

  it("toggles startup registration switch", async () => {
    const user = userEvent.setup();
    render(<App />);

    const startupSwitch = screen.getByRole("switch", { name: "시작프로그램 등록" });
    expect(startupSwitch).not.toBeChecked();

    await user.click(startupSwitch);
    expect(startupSwitch).toBeChecked();
  });

  it("disables server controls when Firebase config is missing", async () => {
    render(<App />);

    await waitFor(() => {
      expect(getStatus()).toHaveTextContent(
        "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다."
      );
    });
    expect(screen.getByRole("button", { name: "서버 백업" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 복원" })).toBeDisabled();
  });

  it("disables backup button before login when config is available", async () => {
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("서버 백업/복원은 구글 로그인 후 사용 가능합니다.");
    });
    expect(screen.getByRole("button", { name: "구글 로그인" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 백업" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 복원" })).toBeDisabled();
  });

  it("hides manual Firebase settings and uses build config when available", async () => {
    window.localStorage.setItem(
      "h-memo.firebaseClientConfig.v1",
      JSON.stringify({
        apiKey: "stored-api-key",
        authDomain: "stored.firebaseapp.com",
        projectId: "stored-project",
        appId: "stored-app-id",
      })
    );
    setMockFirebaseClientEnv({
      apiKey: "build-api-key",
      authDomain: "build.firebaseapp.com",
      projectId: "build-project",
      appId: "build-app-id",
    });

    render(<App />);

    await waitFor(() => {
      expect(mockCreateFirebaseApp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "build-api-key",
          authDomain: "build.firebaseapp.com",
          projectId: "build-project",
          appId: "build-app-id",
        })
      );
    });
    expect(screen.queryByRole("heading", { name: "구글 로그인 설정" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("stored-api-key")).not.toBeInTheDocument();
  });

  it("enables Google login after saving Firebase config in settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("API key"), "api-key");
    await user.type(screen.getByLabelText("Auth domain"), "project.firebaseapp.com");
    await user.type(screen.getByLabelText("Project ID"), "project-id");
    await user.type(screen.getByLabelText("App ID"), "app-id");
    await user.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "서버 백업/복원은 구글 로그인 후 사용 가능합니다."
      );
      expect(screen.getByRole("button", { name: "구글 로그인" })).not.toBeDisabled();
      expect(mockCreateFirebaseApp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "api-key",
          authDomain: "project.firebaseapp.com",
          projectId: "project-id",
          appId: "app-id",
        })
      );
    });
  });

  it("인증 구독 실패 시 인증 상태 복구 실패 메시지를 표시한다", async () => {
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    mockSubscribeAuthUser.mockImplementationOnce(() => {
      throw new Error("listener registration failed");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "인증 상태 복구 실패: listener registration failed"
      );
    });
  });

  it("calls memo-sync backup after login and reports success", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    mockSignInWithGoogle.mockResolvedValue({
      uid: "user-1",
      displayName: "테스터",
      email: "test@example.com",
      photoURL: "",
    });
    mockBackupMemos.mockResolvedValue({
      path: "users/user-1/backups/1",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: now,
        memos: [],
      },
    });

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("로그인했습니다.");
    });

    const backupButton = screen.getByRole("button", { name: "서버 백업" });
    await user.click(backupButton);

    await waitFor(() => {
      expect(mockBackupMemos).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.arrayContaining([
          expect.objectContaining({
            plainText: "로컬 내용",
          }),
        ])
      );
      expect(mockBackupMemos).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("백업 완료: users/user-1/backups/1");
    });
  });

  it("enables server controls when redirect login settles on the Firebase auth user", async () => {
    const user = userEvent.setup();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    const settledUser = {
      uid: "settled-user",
      displayName: "리다이렉트 사용자",
      email: "settled@example.com",
      photoURL: "",
    };
    mockSignInWithGoogle.mockResolvedValue(null);
    mockWaitForSignedInUser
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(settledUser);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));

    await waitFor(() => {
      expect(mockWaitForSignedInUser).toHaveBeenCalledWith(expect.anything(), 8000, undefined);
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "서버 백업" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "서버 복원" })).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent("리다이렉트 사용자님이 로그인했습니다.");
    });
  });

  it("uses desktop browser OAuth and shows the Google login state in the titlebar", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
      googleOAuthClientId: "desktop-client.apps.googleusercontent.com",
    });

    mockStartGoogleDesktopOAuth.mockResolvedValue({
      idToken: "google-id-token",
      accessToken: "google-access-token",
    });
    mockSignInWithGoogle.mockImplementation(async (_auth: unknown, options: any) => {
      expect(options.fallbackToRedirect).toBe(false);
      expect(await options.desktopOAuth()).toEqual({
        idToken: "google-id-token",
        accessToken: "google-access-token",
      });
      return {
        uid: "desktop-user",
        displayName: "데스크톱 사용자",
        email: "desktop@example.com",
        photoURL: "",
      };
    });

    render(<App />);
    await createMemoFromAppMenu(user);

    expect(screen.getByLabelText("구글 로그인 안 됨")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));

    await waitFor(() => {
      expect(mockStartGoogleDesktopOAuth).toHaveBeenCalledWith(
        "desktop-client.apps.googleusercontent.com"
      );
      expect(screen.getByLabelText("구글 로그인됨: 데스크톱 사용자")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "서버 백업" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "서버 복원" })).toBeEnabled();
    });
  });

  it("blocks desktop Google login with a clear setup message when no desktop OAuth client ID is bundled", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
      googleOAuthClientId: "",
    });

    render(<App />);
    await createMemoFromAppMenu(user);

    await waitFor(() => {
      expect(screen.getByLabelText("구글 로그인 설정 필요")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Windows 데스크톱 구글 로그인에는 Desktop OAuth Client ID 설정이 필요합니다."
      );
      expect(screen.getByRole("button", { name: "구글 로그인" })).toBeDisabled();
      expect(mockStartGoogleDesktopOAuth).not.toHaveBeenCalled();
      expect(mockSignInWithGoogle).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "서버 백업" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "서버 복원" })).toBeDisabled();
    });
  });

  it("enables server controls when another memo window shares auth state", async () => {
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    render(<App />);

    await waitFor(() => expect(tauriEventState.authStateListener).not.toBeNull());

    act(() => {
      tauriEventState.authStateListener?.({
        user: {
          uid: "shared-user",
          displayName: "공유 사용자",
          email: "shared@example.com",
          photoURL: "",
        },
        status: "공유 사용자님이 로그인했습니다.",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "서버 백업" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "서버 복원" })).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent("공유 사용자님이 로그인했습니다.");
    });
  });

  it("reloads the memo management list when another window changes the memo store", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const localMemo = createMemo({
      id: "memo-local",
      now: "2026-05-13T09:00:00.000Z",
      plainText: "현재 창 메모",
    });
    tauriRepositoryState.set(localMemo.id, localMemo);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("현재 창 메모")).toBeInTheDocument();
      expect(tauriEventState.memoStoreListener).not.toBeNull();
    });

    tauriRepositoryState.set(
      "memo-external",
      createMemo({
        id: "memo-external",
        now: "2026-05-13T09:01:00.000Z",
        plainText: "외부 창 메모",
      })
    );
    await act(async () => {
      tauriEventState.memoStoreListener?.({ memoId: "memo-external" });
      await Promise.resolve();
    });

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "외부 창 메모 열기" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "외부 창 메모 삭제" })).toBeInTheDocument();
    });
  });

  it("drains a queued desktop save before acknowledging a remote restore lock and blocks new saves", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memo = createMemo({
      id: "memo-remote-restore-lock",
      now: "2026-07-12T09:00:00.000Z",
      plainText: "잠금 전 메모",
    });
    tauriRepositoryState.set(memo.id, memo);
    const pendingSave = deferred<void>();
    mockSaveMemo.mockImplementation(async (nextMemo: any) => {
      await pendingSave.promise;
      return defaultSaveMemo(nextMemo);
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("잠금 전 메모")).toBeInTheDocument();
      expect(tauriEventState.restoreLockRequestedListener).not.toBeNull();
    });
    nativeLeaseState.lease = {
      token: "remote-lock-token",
      owner: "main",
      expiresAtMs: Date.now() + 10_000,
      operationActive: false,
    };

    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "큐에 들어간 저장" },
    });
    await waitFor(() => expect(mockSaveMemo).toHaveBeenCalledTimes(1));

    await act(async () => {
      await tauriEventState.restoreLockRequestedListener?.({ token: "remote-lock-token" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("메모 내용")).toHaveAttribute("readonly");
    });
    const saveCountAtLock = mockSaveMemo.mock.calls.length;
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "잠금 후 저장 시도" },
    });
    expect(mockSaveMemo).toHaveBeenCalledTimes(saveCountAtLock);
    expect(screen.getByLabelText("메모 내용")).toHaveValue("큐에 들어간 저장");
    expect(mockNotifyRestoreLockAcknowledged).not.toHaveBeenCalled();

    expect(screen.getByRole("button", { name: "새 메모" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "큐에 들어간 저장 삭제" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "새 메모" }));
      fireEvent.click(screen.getByRole("button", { name: "큐에 들어간 저장 삭제" }));
      await tauriEventState.trayCreateMemoListener?.();
    });
    expect(mockSaveMemo).toHaveBeenCalledTimes(saveCountAtLock);
    expect(mockSoftDeleteMemo).not.toHaveBeenCalled();
    expect(mockOpenMemoWindow).not.toHaveBeenCalled();

    pendingSave.resolve();
    await waitFor(() => {
      expect(mockNotifyRestoreLockAcknowledged).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "remote-lock-token",
          windowLabel: "main",
          ok: true,
        })
      );
    });

    await act(async () => {
      tauriEventState.restoreLockReleasedListener?.({ token: "remote-lock-token" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("메모 내용")).not.toHaveAttribute("readonly");
    });
  });

  it("starts as remotely locked when a native lease already exists", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    nativeLeaseState.lease = {
      token: "startup-lease-token",
      owner: "other-window",
      expiresAtMs: Date.now() + 10_000,
      operationActive: false,
    };

    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "새 메모" })).toBeDisabled();
      expect(tauriEventState.restoreLockReleasedListener).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "새 메모" }));
    expect(mockSaveMemo).not.toHaveBeenCalled();

    await act(async () => {
      tauriEventState.restoreLockReleasedListener?.({ token: "startup-lease-token" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "새 메모" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "새 메모" }));
    await waitFor(() => expect(mockSaveMemo).toHaveBeenCalled());
  });

  it("drains a queued local delete before desktop restore safety capture", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({ uid: "queue-user", displayName: "큐 사용자", email: "queue@example.com", photoURL: "" });
      return mockAuthUnsubscribe;
    });

    const currentMemo = createMemo({
      id: "desktop-queued-delete-current",
      now: "2026-07-12T18:00:00.000Z",
      plainText: "삭제 대기 메모",
    });
    const otherMemo = createMemo({
      id: "desktop-queued-delete-other",
      now: "2026-07-12T18:01:00.000Z",
      plainText: "남겨둘 메모",
    });
    const restoredMemo = createMemo({
      id: "desktop-queued-delete-restored",
      now: "2026-07-12T18:02:00.000Z",
      plainText: "서버 복원 메모",
    });
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    tauriRepositoryState.set(otherMemo.id, otherMemo);
    mockListBackupSnapshots.mockResolvedValue([
      {
        createdAt: "2026-07-12T18:03:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "queue-user",
          createdAt: "2026-07-12T18:03:00.000Z",
          memos: [restoredMemo],
        },
      },
    ]);
    mockDeleteBackedUpMemo.mockResolvedValue(0);

    const editSaveGate = deferred<void>();
    const deleteGate = deferred<void>();
    let holdLocalDelete = true;
    let safetyAtFirstRestoreMutation: string | null = null;
    const storage = window.localStorage;
    mockSaveMemo.mockImplementation(async (memo: any) => {
      if (memo.id === currentMemo.id && memo.plainText === "편집 큐") {
        await editSaveGate.promise;
      }
      if (storage.getItem(RESTORE_SAFETY_KEY) && safetyAtFirstRestoreMutation === null) {
        safetyAtFirstRestoreMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSaveMemo(memo);
    });
    mockSoftDeleteMemo.mockImplementation(async (id: string, deletedAt: string) => {
      if (id === currentMemo.id && holdLocalDelete) {
        holdLocalDelete = false;
        await deleteGate.promise;
      }
      if (storage.getItem(RESTORE_SAFETY_KEY) && safetyAtFirstRestoreMutation === null) {
        safetyAtFirstRestoreMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSoftDeleteMemo(id, deletedAt);
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("삭제 대기 메모")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "편집 큐" },
    });
    await waitFor(() => expect(mockSaveMemo).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "편집 큐 삭제" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
      fireEvent.click(screen.getByRole("button", { name: "서버 복원" }));
    });
    editSaveGate.resolve();

    await waitFor(() => {
      expect(mockSoftDeleteMemo).toHaveBeenCalledWith(
        currentMemo.id,
        expect.any(String)
      );
      expect(screen.getByRole("dialog", { name: "백업 기록 선택" })).toBeInTheDocument();
    });

    const historyDialog = screen.getByRole("dialog", { name: "백업 기록 선택" });
    await user.click(within(historyDialog).getByRole("button", { name: "복원" }));
    await waitFor(() => expect(mockNotifyRestoreLockRequested).toHaveBeenCalled());
    deleteGate.resolve();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("복원 완료: 1개 메모");
    });
    const safetyPoint = JSON.parse(storage.getItem(RESTORE_SAFETY_KEY) ?? "null");
    expect(safetyPoint.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      [currentMemo.id, otherMemo.id].sort()
    );
    expect(safetyPoint.payload.memos.find((memo: { id: string }) => memo.id === currentMemo.id)).toMatchObject({
      deletedAt: expect.any(String),
    });
    expect(safetyAtFirstRestoreMutation).toBe(JSON.stringify(safetyPoint));
  });

  it("backs up latest edit even when persistence is delayed", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const pendingEditSave = deferred<void>();
    let saveCallCount = 0;

    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    mockSaveMemo.mockImplementation(async (nextMemo: unknown) => {
      saveCallCount += 1;
      if (saveCallCount > 1) {
        await pendingEditSave.promise;
      }
      return defaultSaveMemo(nextMemo as any);
    });

    mockSignInWithGoogle.mockResolvedValue({
      uid: "user-1",
      displayName: "테스터",
      email: "test@example.com",
      photoURL: "",
    });
    mockBackupMemos.mockResolvedValue({
      path: "users/user-1/backups/1",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: now,
        memos: [],
      },
    });

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "초기 내용" },
    });

    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "최종 내용" },
    });

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("로그인했습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버 백업" }));

    pendingEditSave.resolve();
    await waitFor(() => {
      expect(mockBackupMemos).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.arrayContaining([
          expect.objectContaining({
            plainText: "최종 내용",
          }),
        ])
      );
      expect(screen.getByRole("status")).toHaveTextContent("백업 완료: users/user-1/backups/1");
    });
  });

  it("does not hide local memo when restore persistence fails", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    const restoredMemo = getMemoFromTime({
      id: "server-1",
      now: "2026-01-02T03:00:00.000Z",
      title: "서버복원메모",
      text: "서버 복원 텍스트",
    });

    mockSignInWithGoogle.mockResolvedValue({
      uid: "user-1",
      displayName: "테스터",
      email: "test@example.com",
      photoURL: "",
    });
    mockListBackupSnapshots.mockResolvedValue([
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          memos: [restoredMemo],
        },
      },
    ]);
    mockSoftDeleteMemo.mockImplementation(async () => {
      throw new Error("persist soft delete failed");
    });

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("로그인했습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    await user.click(within(dialog).getByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("복원 실패:");
      expect(screen.queryByDisplayValue("서버 복원 텍스트")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("로컬 내용")).toBeInTheDocument();
    });
  });

  it("does not soft delete local memo when restored memo save fails", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    const restoredMemo = getMemoFromTime({
      id: "server-1",
      now: "2026-01-02T03:00:00.000Z",
      title: "서버복원메모",
      text: "서버 복원 텍스트",
    });

    mockSignInWithGoogle.mockResolvedValue({
      uid: "user-1",
      displayName: "테스터",
      email: "test@example.com",
      photoURL: "",
    });
    mockListBackupSnapshots.mockResolvedValue([
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          memos: [restoredMemo],
        },
      },
    ]);
    mockSaveMemo.mockImplementation(async (memo: unknown) => {
      if ((memo as { id?: string }).id === "server-1") {
        throw new Error("server memo save failed");
      }
      return defaultSaveMemo(memo as any);
    });

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });
    const localMemoId = [...tauriRepositoryState.keys()][0];

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    await user.click(within(dialog).getByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("복원 실패:");
      expect(screen.queryByDisplayValue("서버 복원 텍스트")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("로컬 내용")).toBeInTheDocument();
    });
    expect(mockSoftDeleteMemo).not.toHaveBeenCalledWith(localMemoId, expect.any(String));
  });

  it("restores selected backup and replaces local memos", async () => {
    const user = userEvent.setup();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    const restoredMemo = createMemo({
      id: "server-1",
      now: "2026-01-02T03:00:00.000Z",
      title: "서버복원메모",
      plainText: "서버 복원 텍스트",
    });

    mockSignInWithGoogle.mockResolvedValue({
      uid: "user-1",
      displayName: "테스터",
      email: "test@example.com",
      photoURL: "",
    });
    mockListBackupSnapshots.mockResolvedValue([
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          memos: [restoredMemo],
        },
      },
    ]);

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("로그인했습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    await user.click(within(dialog).getByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(mockListBackupSnapshots).toHaveBeenCalledTimes(1);
      expect(mockRestoreLatestBackup).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("복원 완료: 1개 메모");
    });

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining(new Date("2026-01-01T00:00:00.000Z").toLocaleString("ko-KR"))
    );
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1개 메모"));
    const safetyPoint = JSON.parse(
      window.localStorage.getItem(RESTORE_SAFETY_KEY) ?? "null"
    );
    expect(safetyPoint.source).toBe("server");
    expect(safetyPoint.payload.memos).toEqual(
      expect.arrayContaining([expect.objectContaining({ plainText: "로컬 내용" })])
    );

    expect(screen.queryByDisplayValue("로컬 내용")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("서버 복원 텍스트")).toBeInTheDocument();
  });

  it("opens backup history and restores the selected backup snapshot", async () => {
    const user = userEvent.setup();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    const olderMemo = createMemo({
      id: "server-old",
      now: "2026-01-01T03:00:00.000Z",
      title: "이전서버메모",
      plainText: "이전 백업 텍스트",
    });
    const selectedMemo = createMemo({
      id: "server-selected",
      now: "2026-01-02T03:00:00.000Z",
      title: "선택서버메모",
      plainText: "선택한 백업 텍스트",
    });

    mockSignInWithGoogle.mockResolvedValue({
      uid: "user-1",
      displayName: "테스터",
      email: "test@example.com",
      photoURL: "",
    });
    mockListBackupSnapshots.mockResolvedValue([
      {
        createdAt: "2026-01-02T03:10:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2030-01-02T03:10:00.000Z",
          memos: [selectedMemo],
        },
      },
      {
        createdAt: "2026-01-01T03:10:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2020-01-01T03:10:00.000Z",
          memos: [olderMemo],
        },
      },
    ]);

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));

    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    expect(mockListBackupSnapshots).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(mockRestoreLatestBackup).not.toHaveBeenCalled();
    expect(within(dialog).getByText("2026-01-02T03:10:00.000Z")).toBeInTheDocument();
    expect(within(dialog).queryByText("2030-01-02T03:10:00.000Z")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("1개 메모")).toHaveLength(2);
    expect(screen.getByDisplayValue("로컬 내용")).toBeInTheDocument();

    await user.click(within(dialog).getAllByRole("button", { name: "복원" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("복원 완료: 1개 메모");
    });
    expect(screen.queryByDisplayValue("로컬 내용")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("선택한 백업 텍스트")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "백업 기록 선택" })).not.toBeInTheDocument();
  });

  it("writes desktop restore safety before the first snapshot mutation", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({ uid: "user-1", displayName: "테스터", email: "test@example.com", photoURL: "" });
      return mockAuthUnsubscribe;
    });
    const currentMemo = createMemo({
      id: "desktop-snapshot-current",
      now: "2026-07-12T17:00:00.000Z",
      plainText: "스냅샷 전 메모",
    });
    const deletedMemo = {
      ...createMemo({
        id: "desktop-snapshot-deleted",
        now: "2026-07-12T17:01:00.000Z",
        plainText: "스냅샷 전 삭제 메모",
      }),
      deletedAt: "2026-07-12T17:02:00.000Z",
      windowState: { ...currentMemo.windowState, visible: false },
    };
    const restoredMemo = createMemo({
      id: "desktop-snapshot-restored",
      now: "2026-07-12T17:03:00.000Z",
      plainText: "스냅샷 복원 메모",
    });
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    tauriRepositoryState.set(deletedMemo.id, deletedMemo);
    mockListBackupSnapshots.mockResolvedValue([
      {
        createdAt: "2026-07-12T17:04:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2026-07-12T17:04:00.000Z",
          memos: [restoredMemo],
        },
      },
    ]);

    const storage = window.localStorage;
    let safetyAtFirstMutation: string | null = null;
    mockSaveMemo.mockImplementation(async (memo: any) => {
      if (safetyAtFirstMutation === null) {
        safetyAtFirstMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSaveMemo(memo);
    });
    mockSoftDeleteMemo.mockImplementation(async (id: string, deletedAt: string) => {
      if (safetyAtFirstMutation === null) {
        safetyAtFirstMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSoftDeleteMemo(id, deletedAt);
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("스냅샷 전 메모")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    await user.click(within(dialog).getByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("스냅샷 복원 메모")).toBeInTheDocument();
    });
    const safetyPoint = JSON.parse(storage.getItem(RESTORE_SAFETY_KEY) ?? "null");
    expect(safetyPoint.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      [currentMemo.id, deletedMemo.id].sort()
    );
    expect(safetyAtFirstMutation).toBe(JSON.stringify(safetyPoint));
  });

  it("복구된 로그인 세션이 있을 때 백업/복원 버튼이 활성화된다", async () => {
    const user = userEvent.setup();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });

    mockSubscribeAuthUser.mockImplementation((_, callback: (user: unknown) => void) => {
      callback({
        uid: "restored-user",
        displayName: "기존 사용자",
        email: "existing@example.com",
        photoURL: "https://example.com/photo.png",
      });
      return mockAuthUnsubscribe;
    });
    mockBackupMemos.mockResolvedValue({
      path: "users/restored-user/backups/1",
      payload: {
        version: 1,
        userId: "restored-user",
        createdAt: "2026-05-13T09:00:00.000Z",
        memos: [],
      },
    });

    render(<App />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "복구 세션 텍스트" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "서버 백업" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "서버 복원" })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "서버 백업" }));

    await waitFor(() => {
      expect(mockBackupMemos).toHaveBeenCalledWith(
        expect.anything(),
        "restored-user",
        expect.arrayContaining([expect.objectContaining({ plainText: "복구 세션 텍스트" })])
      );
      expect(screen.getByRole("status")).toHaveTextContent("백업 완료: users/restored-user/backups/1");
    });
  });

  it("shows backed up server memos so deleted local memos can be restored or removed from DB", async () => {
    const user = userEvent.setup();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "server-user",
        displayName: "서버 사용자",
        email: "server@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    const deletedServerMemo = {
      ...createMemo({
        id: "memo-server-deleted",
        now: "2026-05-13T09:00:00.000Z",
        plainText: "서버에 남은 삭제 메모",
      }),
      deletedAt: "2026-05-13T09:10:00.000Z",
    };
    mockListBackedUpMemos.mockResolvedValue([
      {
        memo: deletedServerMemo,
        backupCreatedAt: "2026-05-13T09:11:00.000Z",
      },
    ]);
    mockDeleteBackedUpMemo.mockResolvedValue(2);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "서버 메모 관리" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    await waitFor(() => {
      expect(mockListBackedUpMemos).toHaveBeenCalledWith(expect.anything(), "server-user");
      expect(screen.getByRole("dialog", { name: "서버 메모 관리" })).toHaveTextContent(
        "서버에 남은 삭제 메모"
      );
      expect(screen.getByRole("status")).toHaveTextContent("서버 메모 1개를 불러왔습니다.");
    });

    await user.click(screen.getByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("서버에 남은 삭제 메모")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("서버 백업에서 메모를 복원했습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버 삭제" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "서버 백업에서 이 메모를 삭제합니다. 삭제한 뒤에는 서버에서 복원할 수 없습니다. 계속할까요?"
    );
    await waitFor(() => {
      expect(mockDeleteBackedUpMemo).toHaveBeenCalledWith(
        expect.anything(),
        "server-user",
        "memo-server-deleted"
      );
      const serverDialog = screen.getByRole("dialog", { name: "서버 메모 관리" });
      expect(screen.getByRole("status")).toHaveTextContent(
        '서버 백업에서 "서버에 남은 삭제 메모" 메모를 삭제했습니다.'
      );
      expect(within(serverDialog).queryByRole("listitem")).not.toBeInTheDocument();
      expect(screen.getByText("서버에 저장된 메모가 없습니다.")).toBeInTheDocument();
    });
  });

  it("captures all desktop memos before individual server restore and undo", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "server-user",
        displayName: "서버 사용자",
        email: "server@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    const currentMemo = createMemo({
      id: "desktop-individual-current",
      now: "2026-07-12T14:00:00.000Z",
      plainText: "복원 전 데스크톱 메모",
    });
    const deletedMemo = {
      ...createMemo({
        id: "desktop-individual-deleted",
        now: "2026-07-12T14:01:00.000Z",
        plainText: "삭제된 데스크톱 메모",
      }),
      deletedAt: "2026-07-12T14:02:00.000Z",
      windowState: { ...currentMemo.windowState, visible: false },
    };
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    tauriRepositoryState.set(deletedMemo.id, deletedMemo);
    mockListBackedUpMemos.mockResolvedValue([
      {
        memo: deletedMemo,
        backupCreatedAt: "2026-07-12T14:03:00.000Z",
      },
    ]);

    const storage = window.localStorage;
    const mutationOrder: string[] = [];
    let safetyAtFirstMutation: string | null = null;
    mockSaveMemo.mockImplementation(async (memo: any) => {
      mutationOrder.push(`save:${memo.id}`);
      if (safetyAtFirstMutation === null) {
        safetyAtFirstMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSaveMemo(memo);
    });
    mockSoftDeleteMemo.mockImplementation(async (id: string, deletedAt: string) => {
      mutationOrder.push(`soft-delete:${id}`);
      if (safetyAtFirstMutation === null) {
        safetyAtFirstMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      return defaultSoftDeleteMemo(id, deletedAt);
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("복원 전 데스크톱 메모")).toBeInTheDocument();
    });
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    await user.click(await screen.findByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("서버 백업에서 메모를 복원했습니다.");
      expect(tauriRepositoryState.get(deletedMemo.id)).toMatchObject({
        id: deletedMemo.id,
        deletedAt: null,
      });
    });

    const safetyPoint = JSON.parse(storage.getItem(RESTORE_SAFETY_KEY) ?? "null");
    expect(safetyPoint.source).toBe("server");
    expect(safetyPoint.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      [currentMemo.id, deletedMemo.id].sort()
    );
    expect(safetyAtFirstMutation).toBe(JSON.stringify(safetyPoint));
    expect(mutationOrder[0]).toBe(`save:${currentMemo.id}`);

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "마지막 복원 되돌리기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("마지막 복원을 되돌렸습니다.");
      expect(screen.getByDisplayValue("복원 전 데스크톱 메모")).toBeInTheDocument();
    });
    expect(storage.getItem(RESTORE_SAFETY_KEY)).toBeNull();
    expect(
      [...tauriRepositoryState.values()].map((memo: { id: string }) => memo.id).sort()
    ).toEqual([currentMemo.id, deletedMemo.id].sort());
    expect(tauriRepositoryState.get(deletedMemo.id)).toMatchObject({
      id: deletedMemo.id,
      deletedAt: deletedMemo.deletedAt,
    });
  });

  it("does not mutate desktop memos when individual restore safety storage fails", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "server-user",
        displayName: "서버 사용자",
        email: "server@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    const currentMemo = createMemo({
      id: "desktop-individual-failure-current",
      now: "2026-07-12T15:00:00.000Z",
      plainText: "저장 실패에도 유지할 데스크톱 메모",
    });
    const deletedMemo = {
      ...createMemo({
        id: "desktop-individual-failure-deleted",
        now: "2026-07-12T15:01:00.000Z",
        plainText: "복원되지 않을 데스크톱 메모",
      }),
      deletedAt: "2026-07-12T15:02:00.000Z",
      windowState: { ...currentMemo.windowState, visible: false },
    };
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    tauriRepositoryState.set(deletedMemo.id, deletedMemo);
    mockListBackedUpMemos.mockResolvedValue([
      { memo: deletedMemo, backupCreatedAt: "2026-07-12T15:03:00.000Z" },
    ]);
    const nativeStorage = window.localStorage;
    const failingStorage: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error("quota exceeded");
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: failingStorage,
    });

    try {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByDisplayValue("저장 실패에도 유지할 데스크톱 메모")).toBeInTheDocument();
      });
      await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
      await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
      await user.click(await screen.findByRole("button", { name: "복원" }));

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent("서버 메모 복원 실패");
      });
      expect(screen.queryByDisplayValue("복원되지 않을 데스크톱 메모")).not.toBeInTheDocument();
      expect(mockSaveMemo).not.toHaveBeenCalled();
      expect(mockSoftDeleteMemo).not.toHaveBeenCalled();
      expect([...tauriRepositoryState.keys()].sort()).toEqual(
        [currentMemo.id, deletedMemo.id].sort()
      );
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: nativeStorage,
      });
    }
  });

  it("does not mutate desktop memos when safety serialization fails on cyclic rich content", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({ uid: "server-user", displayName: "서버 사용자", email: "server@example.com", photoURL: "" });
      return mockAuthUnsubscribe;
    });
    const cyclicRichContent: Record<string, unknown> = { type: "doc" };
    cyclicRichContent.self = cyclicRichContent;
    const currentMemo = {
      ...createMemo({
        id: "desktop-cyclic-current",
        now: "2026-07-12T16:00:00.000Z",
        plainText: "순환 데이터 메모",
      }),
      richContent: cyclicRichContent,
    };
    tauriRepositoryState.set(currentMemo.id, currentMemo);
    mockListBackedUpMemos.mockResolvedValue([
      {
        memo: { ...currentMemo, deletedAt: "2026-07-12T16:01:00.000Z" },
        backupCreatedAt: "2026-07-12T16:02:00.000Z",
      },
    ]);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("순환 데이터 메모")).toBeInTheDocument();
    });
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    await user.click(await screen.findByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("서버 메모 복원 실패: 복원 안전 지점");
    });
    expect(mockSaveMemo).not.toHaveBeenCalled();
    expect(mockSoftDeleteMemo).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(RESTORE_SAFETY_KEY)).toBeNull();
  });

  it("reloads the durable undo point after another desktop window restores", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    const memo = createMemo({
      id: "desktop-cross-window-undo",
      now: "2026-07-12T16:10:00.000Z",
      plainText: "다른 데스크톱 창의 복원 메모",
    });
    tauriRepositoryState.set(memo.id, memo);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("다른 데스크톱 창의 복원 메모")).toBeInTheDocument();
      expect(tauriEventState.restoreSafetyChangedListener).not.toBeNull();
    });

    const safetyPoint = {
      version: 1,
      source: "server",
      createdAt: "2026-07-12T16:11:00.000Z",
      payload: {
        version: 1,
        userId: "desktop-user",
        createdAt: "2026-07-12T16:11:00.000Z",
        memos: [memo],
      },
    };
    window.localStorage.setItem(RESTORE_SAFETY_KEY, JSON.stringify(safetyPoint));
    act(() => {
      tauriEventState.restoreSafetyChangedListener?.();
    });

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
    });

    const newerPoint = { ...safetyPoint, createdAt: "2026-07-12T16:12:00.000Z" };
    window.localStorage.setItem(RESTORE_SAFETY_KEY, JSON.stringify(newerPoint));
    act(() => {
      tauriEventState.restoreSafetyChangedListener?.();
    });
    expect(JSON.parse(window.localStorage.getItem(RESTORE_SAFETY_KEY) ?? "null").createdAt).toBe(
      newerPoint.createdAt
    );
    expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
  });

  it("reloads canUndo from durable polling when the restore-safety event is lost", async () => {
    vi.useFakeTimers();
    try {
      setTauriRuntime(true);
      mockGetStartupEnabled.mockResolvedValue(false);
      const memo = createMemo({
        id: "desktop-polling-undo",
        now: "2026-07-12T16:20:00.000Z",
        plainText: "폴링으로 찾을 메모",
      });
      tauriRepositoryState.set(memo.id, memo);

      render(<App />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByDisplayValue("폴링으로 찾을 메모")).toBeInTheDocument();

      window.localStorage.setItem(
        RESTORE_SAFETY_KEY,
        JSON.stringify({
          version: 1,
          source: "server",
          createdAt: "2026-07-12T16:21:00.000Z",
          payload: {
            version: 1,
            userId: "desktop-user",
            createdAt: "2026-07-12T16:21:00.000Z",
            memos: [memo],
          },
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.click(screen.getAllByLabelText("메모 메뉴")[0]!);
      expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mutate the server after a restore lock begins during delete confirmation", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({ uid: "server-user", displayName: "서버 사용자", email: "server@example.com", photoURL: "" });
      return mockAuthUnsubscribe;
    });
    const memo = createMemo({
      id: "desktop-confirmation-lock",
      now: "2026-07-12T16:30:00.000Z",
      plainText: "확인 중 잠금 메모",
    });
    const otherMemo = createMemo({
      id: "desktop-confirmation-other",
      now: "2026-07-12T16:31:00.000Z",
      plainText: "남겨둘 확인 메모",
    });
    tauriRepositoryState.set(memo.id, memo);
    tauriRepositoryState.set(otherMemo.id, otherMemo);
    mockDeleteBackedUpMemo.mockResolvedValue(1);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("확인 중 잠금 메모")).toBeInTheDocument();
      expect(tauriEventState.restoreLockRequestedListener).not.toBeNull();
    });
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "확인 중 잠금 메모 삭제" }));
    expect(screen.getByRole("dialog", { name: "메모 삭제" })).toBeInTheDocument();

    nativeLeaseState.lease = {
      token: "confirmation-restore-lock",
      owner: "other-window",
      expiresAtMs: Date.now() + 10_000,
      operationActive: false,
    };
    await act(async () => {
      await tauriEventState.restoreLockRequestedListener?.({ token: "confirmation-restore-lock" });
    });

    await user.click(screen.getByRole("button", { name: "삭제하기" }));

    expect(mockDeleteBackedUpMemo).not.toHaveBeenCalled();
    expect(tauriRepositoryState.has(memo.id)).toBe(true);
  });

  it("keeps server memo visible when server delete reports no stored record", async () => {
    const user = userEvent.setup();
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (signedInUser: unknown) => void) => {
      callback({
        uid: "server-user",
        displayName: "서버 사용자",
        email: "server@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });
    const blankServerMemo = {
      ...createMemo({
        id: "memo-server-empty",
        now: "2026-05-13T09:00:00.000Z",
        plainText: "",
      }),
      deletedAt: null,
    };
    mockListBackedUpMemos.mockResolvedValue([
      {
        memo: blankServerMemo,
        backupCreatedAt: "2026-05-13T09:11:00.000Z",
      },
    ]);
    mockDeleteBackedUpMemo.mockResolvedValue(0);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "서버 메모 관리" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "서버 메모 관리" })).toHaveTextContent("빈 메모");
      expect(screen.getByRole("status")).toHaveTextContent("서버 메모 1개를 불러왔습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버 삭제" }));

    await waitFor(() => {
      expect(mockDeleteBackedUpMemo).toHaveBeenCalledWith(
        expect.anything(),
        "server-user",
        "memo-server-empty"
      );
      const serverDialog = screen.getByRole("dialog", { name: "서버 메모 관리" });
      expect(screen.getByRole("status")).toHaveTextContent(
        '서버 백업에서 "빈 메모" 메모를 찾지 못했습니다. 목록을 새로고침해 주세요.'
      );
      expect(within(serverDialog).getByRole("listitem")).toHaveTextContent("빈 메모");
    });
  });

  it("컴포넌트 unmount 시 auth 구독을 해제한다", () => {
    setMockFirebaseClientEnv({
      apiKey: "api-key",
      authDomain: "project.firebaseapp.com",
      projectId: "project-id",
      appId: "app-id",
    });
    mockSubscribeAuthUser.mockImplementation((_, callback: (user: unknown) => void) => {
      callback({
        uid: "restored-user",
        displayName: "기존 사용자",
        email: "existing@example.com",
        photoURL: "",
      });
      return mockAuthUnsubscribe;
    });

    const { unmount } = render(<App />);

    unmount();

    expect(mockAuthUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
