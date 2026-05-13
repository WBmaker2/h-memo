import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  mockGetFirebaseClientEnv,
  mockBackupMemos,
  mockRestoreLatestBackup,
  mockGetFirestore,
  mockCreateFirebaseApp,
  mockGetFirebaseAuth,
  tauriRepositoryState,
} = vi.hoisted(() => {
  const mockExportTextFile = vi.fn();
  const mockGetStartupEnabled = vi.fn();
  const mockSetStartupEnabled = vi.fn();
  const mockSignInWithGoogle = vi.fn();
  const mockSignOutUser = vi.fn();
  const mockBackupMemos = vi.fn();
  const mockRestoreLatestBackup = vi.fn();
  const mockGetFirestore = vi.fn((_app: unknown) => ({
    isMockFirestore: true,
  })) as Mock<(app: unknown) => { isMockFirestore: true }>;
  const mockCreateFirebaseApp = vi.fn((_env: unknown) => ({
    isMockFirebaseApp: true,
  })) as Mock<(env: unknown) => { isMockFirebaseApp: true }>;
  const mockGetFirebaseAuth = vi.fn((_app: unknown) => ({
    isMockFirebaseAuth: true,
  })) as Mock<(app: unknown) => { isMockFirebaseAuth: true }>;
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

  const saveMemo = async (nextMemo: any) => {
    tauriRepositoryState.set(nextMemo.id, cloneMemo(nextMemo));
    return cloneMemo(nextMemo);
  };

  const softDeleteMemo = async (id: string, deletedAt: string) => {
    const current = tauriRepositoryState.get(id);
    if (!current) {
      throw new Error(`Cannot soft delete memo: memo not found (${id})`);
    }
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    tauriRepositoryState.set(id, cloneMemo(next));
    return cloneMemo(next);
  };

  const restoreMemo = async (id: string, restoredAt: string) => {
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
    saveMemo = saveMemo;
    softDeleteMemo = softDeleteMemo;
    restoreMemo = restoreMemo;
  }

  return {
    mockExportTextFile,
    mockGetStartupEnabled,
    mockSetStartupEnabled,
    mockSignInWithGoogle,
    mockSignOutUser,
    mockGetFirebaseClientEnv,
    mockBackupMemos,
    mockRestoreLatestBackup,
    mockGetFirestore,
    mockCreateFirebaseApp,
    mockGetFirebaseAuth,
    tauriRepositoryState,
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

beforeEach(() => {
  setTauriRuntime(false);
  tauriRepositoryState.clear();
  mockExportTextFile.mockReset();
  mockGetStartupEnabled.mockReset();
  mockSetStartupEnabled.mockReset();
  mockSignInWithGoogle.mockReset();
  mockSignOutUser.mockReset();
  mockBackupMemos.mockReset();
  mockRestoreLatestBackup.mockReset();
  mockGetFirestore.mockReset();
  mockCreateFirebaseApp.mockReset();
  mockGetFirebaseAuth.mockReset();

  mockGetFirestore.mockReturnValue({ isMockFirestore: true });
  mockCreateFirebaseApp.mockReturnValue({ isMockFirebaseApp: true });
  mockGetFirebaseAuth.mockReturnValue({ isMockFirebaseAuth: true });

  setMockFirebaseClientEnv({
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
  });
});

describe("desktop App", () => {
  it("keeps title text as-is in exported text", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "윈도우메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "tray memo" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    const preview = screen.getByLabelText("TXT 미리보기 결과");

    expect(preview).toHaveTextContent(/제목: 윈도우메모/);
    expect(preview).toHaveTextContent(/tray memo/);
  });

  it("hides memo from view after 메모 숨기기", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), { target: { value: "윈도우메모" } });
    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("윈도우메모")).not.toBeInTheDocument();
    });
  });

  it("exports hidden memos too, including via settings panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "숨김메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "숨김 텍스트" },
    });
    await user.click(screen.getByRole("button", { name: "메모 숨기기" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("숨김메모")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));
    let preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/숨김메모/);
    expect(preview).toHaveTextContent(/숨김 텍스트/);

    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));
    preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/숨김메모/);
    expect(preview).toHaveTextContent(/숨김 텍스트/);
  });

  it("keeps browser fallback behavior for text export preview", async () => {
    const user = userEvent.setup();
    render(<App />);

    const status = getStatus();
    expect(status).toHaveTextContent("Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다.");

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "브라우저메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "browser text" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent(/브라우저메모/);
    expect(preview).toHaveTextContent(/browser text/);
    expect(mockExportTextFile).not.toHaveBeenCalled();
  });

  it("displays tauri export cancelled message", async () => {
    const user = userEvent.setup();
    setTauriRuntime(true);
    mockGetStartupEnabled.mockResolvedValue(false);
    mockExportTextFile.mockResolvedValue({ status: "cancelled" });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "취소테스트" },
    });
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

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "실패테스트" },
    });
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

    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "삭제용메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "delete text" },
    });
    await user.click(screen.getByRole("button", { name: "메모 삭제" }));
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).toHaveTextContent("");
    expect(preview).not.toHaveTextContent(/삭제용메모/);
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
      expect(screen.getByRole("status")).toHaveTextContent("백업 정보 없음");
    });
    expect(screen.getByRole("button", { name: "로그인" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 백업" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 복원" })).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "로컬메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });

    await user.click(screen.getByRole("button", { name: "로그인" }));
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
            title: "로컬메모",
            plainText: "로컬 내용",
          }),
        ])
      );
      expect(mockBackupMemos).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("백업 완료: users/user-1/backups/1");
    });
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
    await user.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByLabelText("메모 제목"), {
      target: { value: "로컬메모" },
    });
    fireEvent.change(screen.getByLabelText("메모 내용"), {
      target: { value: "로컬 내용" },
    });

    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("로그인했습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));

    await waitFor(() => {
      expect(mockRestoreLatestBackup).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("복원 완료: 1개 메모");
    });

    expect(screen.queryByDisplayValue("로컬메모")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("서버복원메모")).toBeInTheDocument();
  });
});
