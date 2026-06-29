import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createMemo } from "@h-memo/memo-core";

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
  mockReadWindowBounds,
  mockRestoreWindowBounds,
  mockSetWindowHeight,
  mockListenWindowBoundsChanged,
  mockNotifyMemoStoreChanged,
  mockNotifyAuthStateChanged,
  mockNotifyStartupStateChanged,
  mockStartGoogleDesktopOAuth,
  tauriRepositoryState,
  tauriWindowState,
  tauriEventState,
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
  const mockRestoreWindowBounds = vi.fn();
  const mockSetWindowHeight = vi.fn();
  const mockListenWindowBoundsChanged = vi.fn();
  const mockNotifyMemoStoreChanged = vi.fn();
  const mockNotifyAuthStateChanged = vi.fn();
  const mockNotifyStartupStateChanged = vi.fn();
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

  const cloneMemo = (value: any) => JSON.parse(JSON.stringify(value));

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
    mockReadWindowBounds,
    mockRestoreWindowBounds,
    mockSetWindowHeight,
    mockListenWindowBoundsChanged,
    mockNotifyMemoStoreChanged,
    mockNotifyAuthStateChanged,
    mockNotifyStartupStateChanged,
    mockStartGoogleDesktopOAuth,
    tauriRepositoryState,
    tauriWindowState,
    tauriEventState,
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
  readWindowBounds: () => mockReadWindowBounds(),
  restoreWindowBounds: (bounds: unknown) => mockRestoreWindowBounds(bounds),
  setWindowHeight: (height: number) => mockSetWindowHeight(height),
  listenWindowBoundsChanged: (listener: () => void) => {
    tauriWindowState.boundsListener = listener;
    return mockListenWindowBoundsChanged(listener);
  },
}));

vi.mock("./adapters/tauriEvents", () => ({
  notifyMemoStoreChanged: (payload: unknown) => mockNotifyMemoStoreChanged(payload),
  notifyAuthStateChanged: (payload: unknown) => mockNotifyAuthStateChanged(payload),
  notifyStartupStateChanged: (payload: unknown) => mockNotifyStartupStateChanged(payload),
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
  mockReadWindowBounds.mockReset();
  mockRestoreWindowBounds.mockReset();
  mockSetWindowHeight.mockReset();
  mockListenWindowBoundsChanged.mockReset();
  mockNotifyMemoStoreChanged.mockReset();
  mockNotifyAuthStateChanged.mockReset();
  mockNotifyStartupStateChanged.mockReset();
  mockStartGoogleDesktopOAuth.mockReset();
  tauriWindowState.bounds = { x: 20, y: 30, width: 380, height: 420 };
  tauriWindowState.boundsListener = null;
  tauriWindowState.unlisten.mockReset();
  tauriEventState.memoStoreListener = null;
  tauriEventState.startupStateListener = null;
  tauriEventState.authStateListener = null;
  tauriEventState.unlistenMemoStore.mockReset();
  tauriEventState.unlistenStartupState.mockReset();
  tauriEventState.unlistenAuthState.mockReset();

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
  mockRestoreWindowBounds.mockResolvedValue(undefined);
  mockSetWindowHeight.mockResolvedValue(undefined);
  mockListenWindowBoundsChanged.mockImplementation(async (listener: () => void) => {
    tauriWindowState.boundsListener = listener;
    return tauriWindowState.unlisten;
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
          createdAt: "2026-01-02T03:10:00.000Z",
          memos: [selectedMemo],
        },
      },
      {
        createdAt: "2026-01-01T03:10:00.000Z",
        memoCount: 1,
        payload: {
          version: 1,
          userId: "user-1",
          createdAt: "2026-01-01T03:10:00.000Z",
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
