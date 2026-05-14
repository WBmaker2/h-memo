import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createMemo } from "@h-memo/memo-core";

const {
  MockTauriMemoRepository,
  mockExportTextFile,
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
  mockGetFirestore,
  mockCreateFirebaseApp,
  mockGetFirebaseAuth,
  mockSubscribeAuthUser,
  mockAuthUnsubscribe,
  mockStartWindowDrag,
  mockStartWindowResize,
  mockMinimizeWindow,
  mockToggleMaximizeWindow,
  mockCloseWindow,
  mockReadWindowBounds,
  mockRestoreWindowBounds,
  mockSetWindowHeight,
  mockListenWindowBoundsChanged,
  tauriRepositoryState,
  tauriWindowState,
} = vi.hoisted(() => {
  const mockExportTextFile = vi.fn();
  const mockGetStartupEnabled = vi.fn();
  const mockSetStartupEnabled = vi.fn();
  const mockSignInWithGoogle = vi.fn();
  const mockSignOutUser = vi.fn();
  const mockSaveMemo = vi.fn();
  const mockSoftDeleteMemo = vi.fn();
  const mockRestoreMemo = vi.fn();
  const mockBackupMemos = vi.fn();
  const mockRestoreLatestBackup = vi.fn();
  const mockStartWindowDrag = vi.fn();
  const mockStartWindowResize = vi.fn();
  const mockMinimizeWindow = vi.fn();
  const mockToggleMaximizeWindow = vi.fn();
  const mockCloseWindow = vi.fn();
  const mockRestoreWindowBounds = vi.fn();
  const mockSetWindowHeight = vi.fn();
  const mockListenWindowBoundsChanged = vi.fn();
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
    mockGetFirestore,
    mockCreateFirebaseApp,
    mockGetFirebaseAuth,
    mockSubscribeAuthUser,
    mockAuthUnsubscribe,
    mockStartWindowDrag,
    mockStartWindowResize,
    mockMinimizeWindow,
    mockToggleMaximizeWindow,
    mockCloseWindow,
    mockReadWindowBounds,
    mockRestoreWindowBounds,
    mockSetWindowHeight,
    mockListenWindowBoundsChanged,
    tauriRepositoryState,
    tauriWindowState,
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
}) {
  mockGetFirebaseClientEnv.mockReturnValue({
    apiKey: value.apiKey,
    authDomain: value.authDomain,
    projectId: value.projectId,
    appId: value.appId,
    storageBucket: value.storageBucket ?? "",
    messagingSenderId: value.messagingSenderId ?? "",
    measurementId: value.measurementId ?? "",
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
    subscribeAuthUser: (auth: unknown, callback: (user: unknown) => void) =>
      mockSubscribeAuthUser(auth, callback),
    signInWithGoogle: (auth: unknown) => mockSignInWithGoogle(auth),
    signOutUser: (auth: unknown) => mockSignOutUser(auth),
  };
});

vi.mock("./adapters/tauriPlatform", () => ({
  exportTextFile: (...args: Parameters<typeof mockExportTextFile>) =>
    mockExportTextFile(...args),
  getStartupEnabled: () => mockGetStartupEnabled(),
  setStartupEnabled: (enabled: boolean) => mockSetStartupEnabled(enabled),
}));

vi.mock("./adapters/tauriMemoRepository", () => ({
  TauriMemoRepository: MockTauriMemoRepository,
}));

vi.mock("./adapters/tauriWindow", () => ({
  startWindowDrag: () => mockStartWindowDrag(),
  startWindowResize: (direction: "SouthEast") => mockStartWindowResize(direction),
  minimizeWindow: () => mockMinimizeWindow(),
  toggleMaximizeWindow: () => mockToggleMaximizeWindow(),
  closeWindow: () => mockCloseWindow(),
  readWindowBounds: () => mockReadWindowBounds(),
  restoreWindowBounds: (bounds: unknown) => mockRestoreWindowBounds(bounds),
  setWindowHeight: (height: number) => mockSetWindowHeight(height),
  listenWindowBoundsChanged: (listener: () => void) => {
    tauriWindowState.boundsListener = listener;
    return mockListenWindowBoundsChanged(listener);
  },
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
  mockGetStartupEnabled.mockReset();
  mockSetStartupEnabled.mockReset();
  mockSignInWithGoogle.mockReset();
  mockSignOutUser.mockReset();
  mockSaveMemo.mockReset();
  mockSoftDeleteMemo.mockReset();
  mockRestoreMemo.mockReset();
  mockBackupMemos.mockReset();
  mockRestoreLatestBackup.mockReset();
  mockGetFirestore.mockReset();
  mockCreateFirebaseApp.mockReset();
  mockGetFirebaseAuth.mockReset();
  mockSubscribeAuthUser.mockReset();
  mockAuthUnsubscribe.mockReset();
  mockStartWindowDrag.mockReset();
  mockStartWindowResize.mockReset();
  mockMinimizeWindow.mockReset();
  mockToggleMaximizeWindow.mockReset();
  mockCloseWindow.mockReset();
  mockReadWindowBounds.mockReset();
  mockRestoreWindowBounds.mockReset();
  mockSetWindowHeight.mockReset();
  mockListenWindowBoundsChanged.mockReset();
  tauriWindowState.bounds = { x: 20, y: 30, width: 380, height: 420 };
  tauriWindowState.boundsListener = null;
  tauriWindowState.unlisten.mockReset();

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
  mockMinimizeWindow.mockResolvedValue(undefined);
  mockToggleMaximizeWindow.mockResolvedValue(undefined);
  mockCloseWindow.mockResolvedValue(undefined);
  mockReadWindowBounds.mockImplementation(async () => tauriWindowState.bounds);
  mockRestoreWindowBounds.mockResolvedValue(undefined);
  mockSetWindowHeight.mockResolvedValue(undefined);
  mockListenWindowBoundsChanged.mockImplementation(async (listener: () => void) => {
    tauriWindowState.boundsListener = listener;
    return tauriWindowState.unlisten;
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
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "tray memo" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    const preview = screen.getByLabelText("TXT 미리보기 결과");

    expect(screen.queryByLabelText("메모 제목")).not.toBeInTheDocument();
    expect(preview).not.toHaveTextContent(/제목:/);
    expect(preview).toHaveTextContent(/tray memo/);
  });

  it("hides memo from view after 메모 숨기기", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "윈도우메모" } });
    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("윈도우메모")).not.toBeInTheDocument();
    });
  });

  it("exports hidden memos too, including via settings panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "숨김 텍스트" },
    });
    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("숨김 텍스트")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    let preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/숨김 텍스트/);

    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/숨김 텍스트/);
  });

  it("keeps browser fallback behavior for text export preview", async () => {
    const user = userEvent.setup();
    render(<App />);

    const status = getStatus();
    expect(status).toHaveTextContent("Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다.");

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "browser text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/browser text/);
    expect(mockExportTextFile).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

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
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("TXT 저장 실패: 저장 경로 접근 오류");
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
    tauriWindowState.bounds = { x: 333, y: 444, width: 460, height: 390 };
    tauriWindowState.boundsListener?.();

    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
    });
    vi.useRealTimers();

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

  it("wires the titlebar to Tauri drag, window controls, and collapse resize", async () => {
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
    await user.click(screen.getByRole("button", { name: "최소화" }));
    await user.click(screen.getByRole("button", { name: "최대화" }));
    await user.click(screen.getByRole("button", { name: "종료" }));
    fireEvent.doubleClick(screen.getByLabelText("상단 메뉴바"));

    await waitFor(() => {
      expect(mockStartWindowDrag).toHaveBeenCalledTimes(1);
      expect(mockMinimizeWindow).toHaveBeenCalledTimes(1);
      expect(mockToggleMaximizeWindow).toHaveBeenCalledTimes(1);
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

  it("excludes deleted memo from export", async () => {
    const user = userEvent.setup();
    render(<App />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "delete text" },
    });
    await user.click(screen.getByRole("button", { name: "메모 삭제" }));
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent("");
    expect(preview).not.toHaveTextContent(/delete text/);
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
        "Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다."
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
    mockRestoreLatestBackup.mockResolvedValue({
      version: 1,
      userId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      memos: [restoredMemo],
    });
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
    mockRestoreLatestBackup.mockResolvedValue({
      version: 1,
      userId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      memos: [restoredMemo],
    });
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

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("복원 실패:");
      expect(screen.queryByDisplayValue("서버 복원 텍스트")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("로컬 내용")).toBeInTheDocument();
    });
    expect(mockSoftDeleteMemo).not.toHaveBeenCalledWith(localMemoId, expect.any(String));
  });

  it("restores latest backup and replaces local memos", async () => {
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
    mockRestoreLatestBackup.mockResolvedValue({
      version: 1,
      userId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      memos: [restoredMemo],
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

    await waitFor(() => {
      expect(mockRestoreLatestBackup).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("복원 완료: 1개 메모");
    });

    expect(screen.queryByDisplayValue("로컬 내용")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("서버 복원 텍스트")).toBeInTheDocument();
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
