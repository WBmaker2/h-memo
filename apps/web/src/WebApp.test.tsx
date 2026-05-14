import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupMemos,
  createFirebaseApp,
  getFirebaseAuth,
  restoreLatestBackup,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
} from "@h-memo/memo-sync";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { WebApp } from "./WebApp";

const FIREBASE_UNAVAILABLE_MESSAGE =
  "Firebase 환경 변수가 없어 서버 백업 기능을 사용할 수 없습니다.";
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
    restoreLatestBackup: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOutUser: vi.fn(),
    subscribeAuthUser: vi.fn(),
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

  vi.mocked(getFirebaseClientEnv).mockReturnValue({});
  vi.mocked(createFirebaseApp).mockReturnValue({} as never);
  vi.mocked(getFirebaseAuth).mockReturnValue({} as never);
  vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
    callback(null);
    return vi.fn();
  });
  vi.mocked(signInWithGoogle).mockResolvedValue(LOGGED_IN_USER);
  vi.mocked(signOutUser).mockResolvedValue(undefined);
  vi.mocked(backupMemos).mockResolvedValue({ path: "users/user-1/backupSnapshots/1", payload: {
    version: 1,
    userId: "user-1",
    createdAt: new Date().toISOString(),
    memos: [],
  } });
  vi.mocked(restoreLatestBackup).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe("WebApp", () => {
  it("renders web preview shell", async () => {
    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "H Memo (웹 미리보기)" })).toBeInTheDocument();
      const memoArea = screen.getByRole("region", { name: "메모 목록" });
      expect(within(memoArea).queryByRole("button", { name: "새 메모" })).not.toBeInTheDocument();
      expect(screen.getByText("메모가 없습니다. 상단의 메뉴에서 새 메모를 만들어 보세요.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "TXT 미리보기" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(FIREBASE_UNAVAILABLE_MESSAGE);
      expect(screen.getByRole("switch", { name: "시작프로그램 등록" })).toBeDisabled();
    });
  });

  it("generates TXT preview for edited memo", async () => {
    const user = userEvent.setup();
    render(<WebApp />);

    await createMemoFromAppMenu(user);
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "브라우저에서 저장되는 메모" },
    });
    await user.click(screen.getByRole("button", { name: "TXT 미리보기" }));

    const preview = screen.getByLabelText("TXT 미리보기 결과");
    expect(preview).not.toHaveTextContent(/제목:/);
    expect(preview).toHaveTextContent(/브라우저에서 저장되는 메모/);
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

    const backupButton = screen.getByRole("button", { name: "서버 백업" });
    await user.click(backupButton);

    await waitFor(() => expect(backupMemos).toHaveBeenCalledTimes(1));
    const [, backedUpUserId, memos] = vi.mocked(backupMemos).mock.calls[0]!;
    expect(backedUpUserId).toBe(LOGGED_IN_USER.uid);
    expect(
      memos.some((memo: { plainText: string }) => memo.plainText === "로그인 동작 테스트 메모")
    ).toBe(true);
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

  it("restores memos from latest backup", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    vi.mocked(restoreLatestBackup).mockResolvedValue({
      version: 1,
      userId: "user-1",
      createdAt: "2026-05-13T10:05:00.000Z",
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
          syncState: "local-only",
        },
      ],
    });

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

    await waitFor(() => {
      expect(screen.queryByDisplayValue("삭제되어야 할 로컬 데이터")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("복원된 본문")).toBeInTheDocument();
    });
  });
});
