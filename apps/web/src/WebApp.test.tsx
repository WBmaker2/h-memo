import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  getFirebaseAuth,
  type BackedUpMemo,
  deleteBackedUpMemo,
  listBackedUpMemos,
  listBackupSnapshots,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
  waitForSignedInUser,
} from "@h-memo/memo-sync";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { WebApp } from "./WebApp";

const FIREBASE_UNAVAILABLE_MESSAGE =
  "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 구글 로그인 후 사용 가능합니다.";
const SUCCESS_BACKUP_MESSAGE = "백업 완료:";

const VALID_FIREBASE_ENV = {
  apiKey: "api-key",
  authDomain: "project.firebaseapp.com",
  projectId: "project-id",
  appId: "app-id",
  storageBucket: "bucket",
  messagingSenderId: "sender-id",
  measurementId: "measurement-id",
};

const LOGGED_IN_USER = {
  uid: "user-1",
  displayName: "홍길동",
  email: "hong@example.com",
  photoURL: "",
};
const SERVER_BACKED_UP_MEMO: BackedUpMemo = {
  memo: {
    id: "server-memo-1",
    title: "서버 메모",
    plainText: "서버에서 가져온 웹 메모",
    richContent: { type: "doc", content: [] },
    style: {
      backgroundColor: "#fff7b8",
      textColor: "#1f2937",
      fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
      fontSize: 16,
    },
    windowState: {
      x: null,
      y: null,
      width: 320,
      height: 280,
      visible: false,
      alwaysOnTop: false,
    },
    createdAt: "2026-05-17T09:00:00.000Z",
    updatedAt: "2026-05-17T09:01:00.000Z",
    deletedAt: "2026-05-17T09:02:00.000Z",
    syncState: "backed-up",
  },
  backupCreatedAt: "2026-05-17T09:03:00.000Z",
};

const LOCAL_MEMO_KEY = "h-memo:web-memo-repository-v1";

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({})),
}));

vi.mock("@h-memo/memo-sync", async () => {
  const actual = await vi.importActual<typeof import("@h-memo/memo-sync")>("@h-memo/memo-sync");
  return {
    ...actual,
    createFirebaseApp: vi.fn(),
    getFirebaseAuth: vi.fn(),
    backupMemos: vi.fn(),
    completeGoogleRedirectSignIn: vi.fn(),
    listBackupSnapshots: vi.fn(),
    restoreLatestBackup: vi.fn(),
    listBackedUpMemos: vi.fn(),
    deleteBackedUpMemo: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOutUser: vi.fn(),
    subscribeAuthUser: vi.fn(),
    waitForSignedInUser: vi.fn(),
  };
});

vi.mock("./env/firebaseEnv", () => ({
  getFirebaseClientEnv: vi.fn(),
}));

type LocalStorageStubOptions = {
  initialEntries?: [string, string][];
  failOnSet?: boolean;
};

function installLocalStorageStub(options: LocalStorageStubOptions = {}) {
  const store = new Map<string, string>(options.initialEntries ?? []);

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => {
        store.clear();
      },
      getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        if (options.failOnSet) {
          throw new Error("quota exceeded");
        }
        store.set(String(key), String(value));
      },
    },
    writable: true,
  });

  return store;
}

async function createMemoFromAppMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("앱 메뉴"));
  await user.click(screen.getByRole("button", { name: "새 메모" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  installLocalStorageStub();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:h-memo-backup"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });

  vi.mocked(getFirebaseClientEnv).mockReturnValue({});
  vi.mocked(createFirebaseApp).mockReturnValue({} as never);
  vi.mocked(getFirebaseAuth).mockReturnValue({} as never);
  vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
    callback(null);
    return vi.fn();
  });
  vi.mocked(signInWithGoogle).mockResolvedValue(LOGGED_IN_USER);
  vi.mocked(completeGoogleRedirectSignIn).mockResolvedValue(null);
  vi.mocked(waitForSignedInUser).mockResolvedValue(null);
  vi.mocked(signOutUser).mockResolvedValue(undefined);
  vi.mocked(backupMemos).mockResolvedValue({ path: "users/user-1/backupSnapshots/1", payload: {
    version: 1,
    userId: "user-1",
    createdAt: new Date().toISOString(),
    memos: [],
  } });
  vi.mocked(restoreLatestBackup).mockResolvedValue(null);
  vi.mocked(listBackedUpMemos).mockResolvedValue([]);
  vi.mocked(deleteBackedUpMemo).mockResolvedValue(1);
  vi.mocked(listBackupSnapshots).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("WebApp", () => {
  it("renders shared db web app shell", async () => {
    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "H Memo" })).toBeInTheDocument();
      const memoArea = screen.getByRole("region", { name: "메모 목록" });
      expect(within(memoArea).queryByRole("button", { name: "새 메모" })).not.toBeInTheDocument();
      expect(screen.getByText("메모가 없습니다. 상단의 메뉴에서 새 메모를 만들어 보세요.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "TXT 내보내기" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(FIREBASE_UNAVAILABLE_MESSAGE);
      expect(screen.queryByRole("heading", { name: "시작프로그램" })).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "시작프로그램 등록" })).not.toBeInTheDocument();
    });
  });

  it("exports TXT backup for edited memo", async () => {
    const user = userEvent.setup();
    const appendSpy = vi.spyOn(document.body, "append");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<WebApp />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "브라우저에서 저장되는 메모" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 내보내기" }));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("TXT 백업 파일을 만들었습니다.");
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    appendSpy.mockRestore();
  });

  it("exports local JSON backup for multiple memos", async () => {
    const user = userEvent.setup();
    const appendSpy = vi.spyOn(document.body, "append");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<WebApp />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "첫 웹 메모" },
    });
    await user.click(screen.getByRole("button", { name: "새 메모" }));
    expect(screen.getAllByRole("textbox", { name: "메모 내용" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "JSON 백업" })[0]);

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("JSON 백업 파일을 만들었습니다.");
    });
    expect(appendSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    appendSpy.mockRestore();
  });

  it("restores local JSON backup from a selected file", async () => {
    const user = userEvent.setup();
    const restored = {
      version: 1,
      userId: "local",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [
        {
          ...JSON.parse(
            JSON.stringify({
              id: "web-json-restore",
              title: "새 메모",
              plainText: "웹 JSON 복원",
              richContent: { type: "doc", content: [] },
              style: {
                backgroundColor: "#fff7b8",
                textColor: "#1f2937",
                fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
                fontSize: 16,
              },
              windowState: {
                x: null,
                y: null,
                width: 320,
                height: 280,
                visible: true,
                alwaysOnTop: false,
              },
              createdAt: "2026-05-13T09:00:00.000Z",
              updatedAt: "2026-05-13T09:00:00.000Z",
              deletedAt: null,
              syncState: "queued",
            })
          ),
        },
      ],
    };
    render(<WebApp />);

    const file = new File([JSON.stringify(restored)], "h-memo-backup.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("JSON 백업 파일 선택"), file);

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("현재 메모를 대체합니다")
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("웹 JSON 복원")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원 완료: 1개 메모");
    });
  });

  it("cancels local JSON restore from a selected file", async () => {
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<WebApp />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "현재 웹 메모" },
    });

    const restored = {
      version: 1,
      userId: "local",
      createdAt: "2026-05-13T09:00:00.000Z",
      memos: [
        {
          id: "web-json-cancelled",
          title: "새 메모",
          plainText: "취소된 웹 복원",
          richContent: { type: "doc", content: [] },
          style: {
            backgroundColor: "#fff7b8",
            textColor: "#1f2937",
            fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
            fontSize: 16,
          },
          windowState: {
            x: null,
            y: null,
            width: 320,
            height: 280,
            visible: true,
            alwaysOnTop: false,
          },
          createdAt: "2026-05-13T09:00:00.000Z",
          updatedAt: "2026-05-13T09:00:00.000Z",
          deletedAt: null,
          syncState: "queued",
        },
      ],
    };
    const file = new File([JSON.stringify(restored)], "h-memo-backup.json", {
      type: "application/json",
    });

    await user.upload(screen.getByLabelText("JSON 백업 파일 선택"), file);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원을 취소했습니다.");
    });
    expect(screen.getByDisplayValue("현재 웹 메모")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("취소된 웹 복원")).not.toBeInTheDocument();
  });

  it("persists memo data to localStorage for browser session preview", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WebApp />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "세션 유지 메모" },
    });

    await waitFor(() => {
      const stored = window.localStorage.getItem(LOCAL_MEMO_KEY);
      expect(stored).toBeTruthy();
    });

    const raw = JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]");
    expect(
      raw.some((memo: { plainText: string }) => memo.plainText === "세션 유지 메모")
    ).toBe(true);

    unmount();
    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("세션 유지 메모")).toBeInTheDocument();
    });
  });

  it("loads corrupt legacy localStorage records without crashing", async () => {
    installLocalStorageStub({
      initialEntries: [
        [
          LOCAL_MEMO_KEY,
          JSON.stringify([
            {
              id: "legacy-web-memo",
              title: "복구된 웹 메모",
              plainText: "windowState가 없어도 렌더링됩니다.",
              createdAt: "2026-05-13T10:00:00.000Z",
              updatedAt: "2026-05-13T10:05:00.000Z",
            },
            {
              title: "무시될 메모",
              plainText: "id가 없습니다.",
              createdAt: "2026-05-13T10:00:00.000Z",
              updatedAt: "2026-05-13T10:05:00.000Z",
            },
          ]),
        ],
      ],
    });

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("windowState가 없어도 렌더링됩니다.")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("무시될 메모")).not.toBeInTheDocument();
  });

  it("reports localStorage write failures when creating a memo", async () => {
    const user = userEvent.setup();
    installLocalStorageStub({ failOnSet: true });
    render(<WebApp />);

    await createMemoFromAppMenu(user);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /메모 저장 실패: localStorage 저장 실패/
      );
    });
  });

  it("shows login required state when firebase session is not present", async () => {
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(null);
      return vi.fn();
    });

    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(LOGIN_REQUIRED_MESSAGE);
    });

    expect(screen.getByRole("button", { name: "구글 로그인" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "서버 백업" })).toBeDisabled();
  });

  it("opens server memo manager with login guidance when signed out", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(null);
      return vi.fn();
    });

    render(<WebApp />);

    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
    expect(within(dialog).getByRole("status")).toHaveTextContent(LOGIN_REQUIRED_MESSAGE);
    expect(listBackedUpMemos).not.toHaveBeenCalled();
  });

  it("closes only the selected memo window and keeps the memo reopenable", async () => {
    const user = userEvent.setup();
    installLocalStorageStub({
      initialEntries: [
        [
          LOCAL_MEMO_KEY,
          JSON.stringify([
            {
              id: "web-visible-1",
              title: "새 메모",
              plainText: "111",
              richContent: { type: "doc", content: [] },
              style: {
                backgroundColor: "#fff7b8",
                textColor: "#1f2937",
                fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
                fontSize: 16,
              },
              windowState: {
                x: null,
                y: null,
                width: 320,
                height: 280,
                visible: true,
                alwaysOnTop: false,
              },
              createdAt: "2026-05-17T09:00:00.000Z",
              updatedAt: "2026-05-17T09:00:00.000Z",
              deletedAt: null,
              syncState: "local-only",
            },
            {
              id: "web-visible-2",
              title: "새 메모",
              plainText: "222",
              richContent: { type: "doc", content: [] },
              style: {
                backgroundColor: "#cfe8ff",
                textColor: "#1f2937",
                fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
                fontSize: 16,
              },
              windowState: {
                x: null,
                y: null,
                width: 320,
                height: 280,
                visible: true,
                alwaysOnTop: false,
              },
              createdAt: "2026-05-17T09:01:00.000Z",
              updatedAt: "2026-05-17T09:01:00.000Z",
              deletedAt: null,
              syncState: "local-only",
            },
          ]),
        ],
      ],
    });

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("111")).toBeInTheDocument();
      expect(screen.getByDisplayValue("222")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "222 메모창 닫기" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("111")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("222")).not.toBeInTheDocument();
    });

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]);
    await user.click(screen.getByRole("button", { name: "222 열기" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("111")).toBeInTheDocument();
      expect(screen.getByDisplayValue("222")).toBeInTheDocument();
    });
  });

  it("hides manual Firebase settings when build config is available", async () => {
    installLocalStorageStub({
      initialEntries: [
        [
          "h-memo.firebaseClientConfig.v1",
          JSON.stringify({
            apiKey: "stored-api-key",
            authDomain: "stored.firebaseapp.com",
            projectId: "stored-project",
            appId: "stored-app-id",
          }),
        ],
      ],
    });
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);

    render(<WebApp />);

    await waitFor(() => {
      expect(createFirebaseApp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: VALID_FIREBASE_ENV.apiKey,
          authDomain: VALID_FIREBASE_ENV.authDomain,
          projectId: VALID_FIREBASE_ENV.projectId,
          appId: VALID_FIREBASE_ENV.appId,
        })
      );
    });
    expect(screen.queryByRole("heading", { name: "구글 로그인 설정" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("stored-api-key")).not.toBeInTheDocument();
  });

  it("allows Google login and then performs server backup", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(null);
      return vi.fn();
    });

    render(<WebApp />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "로그인 동작 테스트 메모" },
    });

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("홍길동님이 로그인했습니다.");
    });
    expect(signInWithGoogle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fallbackToRedirect: true })
    );

    const backupButton = screen.getByRole("button", { name: "서버 백업" });
    await user.click(backupButton);

    await waitFor(() => expect(backupMemos).toHaveBeenCalledTimes(1));
    const [, backedUpUserId, memos] = vi.mocked(backupMemos).mock.calls[0]!;
    expect(backedUpUserId).toBe(LOGGED_IN_USER.uid);
    expect(
      memos.some((memo: { plainText: string }) => memo.plainText === "로그인 동작 테스트 메모")
    ).toBe(true);
  });

  it("enables server controls when Google redirect login settles on the auth user", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(null);
      return vi.fn();
    });
    vi.mocked(signInWithGoogle).mockResolvedValue(null);
    vi.mocked(waitForSignedInUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LOGGED_IN_USER);

    render(<WebApp />);

    await user.click(screen.getByRole("button", { name: "구글 로그인" }));

    await waitFor(() => {
      expect(waitForSignedInUser).toHaveBeenCalledWith(expect.anything(), 8000);
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "서버 백업" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "서버 복원" })).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent("홍길동님이 로그인했습니다.");
    });
  });

  it("restores session from auth state and allows backup after pending changes are flushed", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    vi.mocked(backupMemos).mockResolvedValue({
      path: "users/user-1/backupSnapshots/restore-1",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: new Date().toISOString(),
        memos: [],
      },
    });

    render(<WebApp />);
    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "서버 백업 테스트 메모" },
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("홍길동님이 로그인했습니다.");
    });

    const backupButton = screen.getByRole("button", { name: "서버 백업" });
    await user.click(backupButton);

    await waitFor(() => {
      expect(backupMemos).toHaveBeenCalledTimes(1);
    });
    const [, backedUpUserId, memos] = vi.mocked(backupMemos).mock.calls[0]!;
    expect(backedUpUserId).toBe(LOGGED_IN_USER.uid);
    expect(
      memos.some((memo: { plainText: string }) => memo.plainText === "서버 백업 테스트 메모")
    ).toBe(true);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(SUCCESS_BACKUP_MESSAGE);
    });
  });

  it("opens backup history and restores selected server backup", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    const restoredPayload = {
      version: 1 as const,
      userId: "user-1",
      createdAt: "2030-05-13T10:05:00.000Z",
      memos: [
        {
          id: "restored-memo",
          title: "복원 메모",
          plainText: "복원된 본문",
          richContent: { type: "doc", content: [{ type: "paragraph" }] },
          style: {
            backgroundColor: "#fff7b8",
            textColor: "#1f2937",
            fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
            fontSize: 16,
          },
          windowState: {
            x: null,
            y: null,
            width: 320,
            height: 280,
            visible: true,
            alwaysOnTop: false,
          },
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T10:05:00.000Z",
          deletedAt: null,
          syncState: "local-only" as const,
        },
      ],
    };
    vi.mocked(listBackupSnapshots).mockResolvedValue([
      {
        createdAt: "2026-05-13T10:05:00.000Z",
        memoCount: restoredPayload.memos.length,
        payload: restoredPayload,
      },
    ]);

    installLocalStorageStub({
      initialEntries: [
        [
          LOCAL_MEMO_KEY,
          JSON.stringify([
            {
              id: "local-only-memo",
              title: "로컬 메모",
              plainText: "삭제되어야 할 로컬 데이터",
              createdAt: "2026-05-13T09:00:00.000Z",
              updatedAt: "2026-05-13T09:05:00.000Z",
              windowState: {
                x: null,
                y: null,
                width: 320,
                height: 280,
                visible: true,
                alwaysOnTop: false,
              },
              style: {
                backgroundColor: "#fff7b8",
                textColor: "#1f2937",
                fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
                fontSize: 16,
              },
              syncState: "local-only",
              deletedAt: null,
              richContent: { type: "doc", content: [{ type: "paragraph" }] },
            },
          ]),
        ],
      ],
    });

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("삭제되어야 할 로컬 데이터")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));

    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    expect(within(dialog).getByText("2026-05-13T10:05:00.000Z")).toBeInTheDocument();
    expect(within(dialog).queryByText("2030-05-13T10:05:00.000Z")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("삭제되어야 할 로컬 데이터")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "복원" }));

    await waitFor(() => {
      expect(listBackupSnapshots).toHaveBeenCalledTimes(1);
      expect(restoreLatestBackup).not.toHaveBeenCalled();
      expect(screen.queryByDisplayValue("삭제되어야 할 로컬 데이터")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("복원된 본문")).toBeInTheDocument();
    });
  });

  it("opens server memo manager and restores selected server memo", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    render(<WebApp />);

    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
    await waitFor(() => {
      expect(listBackedUpMemos).toHaveBeenCalledWith(expect.anything(), LOGGED_IN_USER.uid);
      expect(screen.getByText("서버에서 가져온 웹 메모")).toBeInTheDocument();
      expect(within(dialog).getByRole("status")).toHaveTextContent("서버 메모 1개를 불러왔습니다.");
    });

    await user.click(screen.getByRole("button", { name: "서버에서 가져온 웹 메모 복원" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue("서버에서 가져온 웹 메모");
      expect(screen.getAllByRole("status").map((status) => status.textContent).join(" ")).toContain(
        "서버 메모 복원 완료"
      );
    });
  });

  it("deletes a server memo from manager and removes it from list", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    render(<WebApp />);

    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
    await user.click(screen.getByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" }));

    await waitFor(() => {
      expect(deleteBackedUpMemo).toHaveBeenCalledWith(expect.anything(), LOGGED_IN_USER.uid, "server-memo-1");
      expect(within(dialog).queryByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" })).toBeNull();
      expect(within(dialog).getByText("서버에 저장된 메모가 없습니다.")).toBeInTheDocument();
      expect(within(dialog).getByRole("status")).toHaveTextContent("서버 메모를 삭제했습니다.");
    });
  });

  it("removes server memo from manager even when delete API returns 0", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(deleteBackedUpMemo).mockResolvedValue(0);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    render(<WebApp />);

    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
    await user.click(screen.getByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" }));

    await waitFor(() => {
      expect(deleteBackedUpMemo).toHaveBeenCalledWith(expect.anything(), LOGGED_IN_USER.uid, "server-memo-1");
      expect(within(dialog).queryByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" })).toBeNull();
      expect(within(dialog).getByText("서버에 저장된 메모가 없습니다.")).toBeInTheDocument();
      expect(within(dialog).getByRole("status")).toHaveTextContent("서버 메모를 삭제했습니다.");
    });
  });

  it("shows restore failure in dialog status when restoring server memo fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    installLocalStorageStub({ failOnSet: true });

    render(<WebApp />);

    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
    await user.click(screen.getByRole("button", { name: "서버에서 가져온 웹 메모 복원" }));

    await waitFor(() => {
      expect(screen.getAllByRole("status").map((status) => status.textContent).join(" ")).toContain(
        "서버 메모 복원 실패"
      );
      expect(within(dialog).getByRole("status")).toHaveTextContent("서버 메모 복원 실패");
    });
  });

  it("shows empty message when server memo manager opens with no backups", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    render(<WebApp />);

    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "서버 메모 관리" });
    expect(within(dialog).getByRole("status")).toHaveTextContent("서버에 저장된 메모가 없습니다.");
  });
});
