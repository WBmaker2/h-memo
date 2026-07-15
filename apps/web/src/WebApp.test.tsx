import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupMemos,
  completeGoogleRedirectSignIn,
  createFirebaseApp,
  getFirebaseAuth,
  type BackedUpMemo,
  type BackupSnapshotSummary,
  deleteBackedUpMemo,
  listBackedUpMemos,
  listBackupSnapshotSummaryPage,
  loadBackupSnapshot,
  signInWithGoogle,
  signOutUser,
  subscribeAuthUser,
  waitForSignedInUser,
} from "@h-memo/memo-sync";
import { createMemo } from "@h-memo/memo-core";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { LocalStorageMemoRepository } from "./adapters/localStorageMemoRepository";
import { WebApp } from "./WebApp";

const FIREBASE_UNAVAILABLE_MESSAGE =
  "구글 로그인 설정이 아직 준비되지 않아 서버 백업 기능을 사용할 수 없습니다.";
const LOGIN_REQUIRED_MESSAGE = "서버 백업/복원은 구글 로그인 후 사용 가능합니다.";
const SUCCESS_BACKUP_MESSAGE = "새 백업을 저장했습니다.";

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
const RESTORE_SAFETY_KEY = "h-memo:restore-safety-v1";
const RESTORE_LEASE_KEY = "h-memo:web-restore-lease-v1";
const RESTORE_EPOCH_KEY = "h-memo:web-restore-epoch-v1";

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
    listBackupSnapshotSummaryPage: vi.fn(),
    loadBackupSnapshot: vi.fn(),
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installExclusiveWebLocks() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  const queues = new Map<string, Promise<void>>();
  const request = vi.fn(
    <T,>(
      name: string,
      optionsOrCallback:
        | LockOptions
        | ((lock: Lock | null) => Promise<T> | T),
      callback?: (lock: Lock | null) => Promise<T> | T
    ) => {
      const operation =
        typeof optionsOrCallback === "function"
          ? optionsOrCallback
          : callback;
      if (!operation) {
        return Promise.reject(new Error("lock callback is required"));
      }
      const previous = queues.get(name) ?? Promise.resolve();
      const result = previous
        .catch(() => {})
        .then(() => operation({ name, mode: "exclusive" } as Lock));
      queues.set(
        name,
        result.then(
          () => undefined,
          () => undefined
        )
      );
      return result;
    }
  );

  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(navigator, "locks", originalDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  };
}

let restoreDefaultWebLocks: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  installLocalStorageStub();
  restoreDefaultWebLocks = installExclusiveWebLocks();
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
  vi.mocked(backupMemos).mockResolvedValue({
    path: "users/user-1/backupSnapshots/1",
    snapshotId: "snapshot-1",
    outcome: "created",
    cleanupPending: false,
    payload: {
      version: 1,
      userId: "user-1",
      createdAt: new Date().toISOString(),
      memos: [],
    },
  });
  vi.mocked(listBackedUpMemos).mockResolvedValue([]);
  vi.mocked(deleteBackedUpMemo).mockResolvedValue(1);
  vi.mocked(listBackupSnapshotSummaryPage).mockResolvedValue({
    summaries: [],
    nextCursor: null,
  });
});

afterEach(() => {
  cleanup();
  restoreDefaultWebLocks?.();
  restoreDefaultWebLocks = undefined;
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

  it("explains that Web Locks support is required before creating a memo", async () => {
    const user = userEvent.setup();
    Reflect.deleteProperty(navigator, "locks");
    render(<WebApp />);

    await createMemoFromAppMenu(user);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Web Locks");
      expect(screen.getByRole("status")).toHaveTextContent("최신 브라우저");
    });
    expect(window.localStorage.getItem(LOCAL_MEMO_KEY)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "메모 내용" })).not.toBeInTheDocument();
  });

  it("does not show an optimistic edit when Web Locks are unavailable", async () => {
    const memo = createMemo({
      id: "unsupported-existing-edit",
      now: "2026-07-13T09:10:00.000Z",
      plainText: "저장 가능한 것처럼 보이면 안 되는 메모",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([memo])]],
    });
    Reflect.deleteProperty(navigator, "locks");
    render(<WebApp />);

    const editor = await screen.findByRole("textbox", { name: "메모 내용" });
    fireEvent.change(editor, {
      target: { value: "저장되지 않은 낙관적 편집" },
    });

    expect(editor).toHaveValue(memo.plainText);
    expect(editor).toHaveAttribute("readonly");
    expect(screen.getByRole("status")).toHaveTextContent("Web Locks");
    expect(
      JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]")[0].plainText
    ).toBe(memo.plainText);
  });

  it("disables restore and server mutation controls when Web Locks are unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    Reflect.deleteProperty(navigator, "locks");

    render(<WebApp />);
    await user.click(screen.getByLabelText("앱 메뉴"));

    expect(screen.getByRole("button", { name: "서버 메모 관리" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 백업" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "서버 복원" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "JSON 복원" })).toBeDisabled();
    expect(screen.getByLabelText("JSON 백업 파일 선택")).toBeDisabled();
    expect(screen.getByRole("button", { name: "JSON 백업" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Web Locks");
    expect(window.confirm).not.toHaveBeenCalled();
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

  it("persists every browser memo before JSON restore and supports one-step undo", async () => {
    const user = userEvent.setup();
    const currentMemo = createMemo({
      id: "memo-web-current-with-undo",
      now: "2026-07-12T09:00:00.000Z",
      plainText: "복원 전 웹 메모",
    });
    const deletedMemo = {
      ...createMemo({
        id: "memo-web-deleted-with-undo",
        now: "2026-07-12T09:01:00.000Z",
        plainText: "삭제된 웹 메모",
      }),
      deletedAt: "2026-07-12T09:02:00.000Z",
      windowState: {
        ...currentMemo.windowState,
        visible: false,
      },
    };
    const restoredMemo = createMemo({
      id: "memo-web-restored-with-undo",
      now: "2026-07-12T09:03:00.000Z",
      plainText: "복원된 웹 메모",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([currentMemo, deletedMemo])]],
    });

    let safetyAtMemoWrite: string | null = null;
    const storage = window.localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      if (key === LOCAL_MEMO_KEY && safetyAtMemoWrite === null) {
        safetyAtMemoWrite = storage.getItem(RESTORE_SAFETY_KEY);
      }
      originalSetItem(key, value);
    };

    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("복원 전 웹 메모")).toBeInTheDocument();
    });

    const restored = {
      version: 1,
      userId: "local",
      createdAt: "2026-07-12T09:04:00.000Z",
      memos: [restoredMemo],
    };
    await user.upload(
      screen.getByLabelText("JSON 백업 파일 선택"),
      new File([JSON.stringify(restored)], "h-memo-backup.json", { type: "application/json" })
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("복원된 웹 메모")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("JSON 복원 완료: 1개 메모");
    });

    const safetyPointBeforeUndo = JSON.parse(
      storage.getItem(RESTORE_SAFETY_KEY) ?? "null"
    );
    expect(safetyPointBeforeUndo.source).toBe("json");
    expect(safetyPointBeforeUndo.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      [currentMemo.id, deletedMemo.id].sort()
    );
    expect(safetyAtMemoWrite).toBeTruthy();

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    let safetyAtUndoWrite: string | null = null;
    storage.setItem = (key: string, value: string) => {
      if (key === LOCAL_MEMO_KEY && safetyAtUndoWrite === null) {
        safetyAtUndoWrite = storage.getItem(RESTORE_SAFETY_KEY);
      }
      originalSetItem(key, value);
    };

    await user.click(screen.getByRole("button", { name: "마지막 복원 되돌리기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("마지막 복원을 되돌렸습니다.");
      expect(screen.getByDisplayValue("복원 전 웹 메모")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("복원된 웹 메모")).not.toBeInTheDocument();
    expect(safetyAtUndoWrite).toEqual(JSON.stringify(safetyPointBeforeUndo));
    expect(storage.getItem(RESTORE_SAFETY_KEY)).toBeNull();
  });

  it("does not replace browser memos when restore safety storage fails", async () => {
    const user = userEvent.setup();
    const currentMemo = createMemo({
      id: "memo-web-storage-failure-current",
      now: "2026-07-12T10:00:00.000Z",
      plainText: "저장 실패에도 유지할 웹 메모",
    });
    const restoredMemo = createMemo({
      id: "memo-web-storage-failure-restored",
      now: "2026-07-12T10:01:00.000Z",
      plainText: "저장 실패로 복원되지 않을 메모",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([currentMemo])]],
      failOnSet: true,
    });
    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("저장 실패에도 유지할 웹 메모")).toBeInTheDocument();
    });

    await user.upload(
      screen.getByLabelText("JSON 백업 파일 선택"),
      new File(
        [
          JSON.stringify({
            version: 1,
            userId: "local",
            createdAt: "2026-07-12T10:02:00.000Z",
            memos: [restoredMemo],
          }),
        ],
        "h-memo-backup.json",
        { type: "application/json" }
      )
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "복원 안전 지점 및 탭 간 잠금을 저장하지 못했습니다"
      );
      expect(screen.getByDisplayValue("저장 실패에도 유지할 웹 메모")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("저장 실패로 복원되지 않을 메모")).not.toBeInTheDocument();
  });

  it("surfaces restore, rollback, and lease cleanup failures together", async () => {
    const currentMemo = createMemo({
      id: "web-rollback-current",
      now: "2026-07-12T10:10:00.000Z",
      plainText: "롤백 실패 전 메모",
    });
    const firstRestoredMemo = createMemo({
      id: "web-rollback-first",
      now: "2026-07-12T10:11:00.000Z",
      plainText: "첫 번째 복원 메모",
    });
    const secondRestoredMemo = createMemo({
      id: "web-rollback-second",
      now: "2026-07-12T10:12:00.000Z",
      plainText: "두 번째 복원 메모",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([currentMemo])]],
    });
    const storage = window.localStorage;
    const originalRemoveItem = storage.removeItem.bind(storage);
    storage.removeItem = (key: string) => {
      if (key === RESTORE_LEASE_KEY) {
        throw new Error("웹 잠금 정리 실패");
      }
      originalRemoveItem(key);
    };
    const originalSave = LocalStorageMemoRepository.prototype.saveMemo;
    let saveCallCount = 0;
    const saveSpy = vi
      .spyOn(LocalStorageMemoRepository.prototype, "saveMemo")
      .mockImplementation(async function (this: LocalStorageMemoRepository, memo) {
        saveCallCount += 1;
        if (saveCallCount === 2) {
          throw new Error("복원 쓰기 실패");
        }
        if (saveCallCount === 3) {
          throw new Error("롤백 저장 실패");
        }
        return originalSave.call(this, memo);
      });
    const deleteSpy = vi
      .spyOn(LocalStorageMemoRepository.prototype, "softDeleteMemo")
      .mockRejectedValue(new Error("롤백 삭제 실패"));

    try {
      render(<WebApp />);
      await waitFor(() => {
        expect(screen.getByDisplayValue("롤백 실패 전 메모")).toBeInTheDocument();
      });

      await userEvent.upload(
        screen.getByLabelText("JSON 백업 파일 선택"),
        new File(
          [
            JSON.stringify({
              version: 1,
              userId: "local",
              createdAt: "2026-07-12T10:13:00.000Z",
              memos: [firstRestoredMemo, secondRestoredMemo],
            }),
          ],
          "rollback-failure.json",
          { type: "application/json" }
        )
      );

      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("JSON 복원 실패:");
        expect(status).toHaveTextContent("복원 쓰기 실패");
        expect(status).toHaveTextContent("롤백 삭제 실패");
        expect(status).toHaveTextContent("롤백 저장 실패");
        expect(status).toHaveTextContent("웹 잠금 정리 실패");
      });
    } finally {
      saveSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("initializes undo from a valid persisted safety point", async () => {
    const memo = createMemo({
      id: "memo-persisted-undo",
      now: "2026-07-12T12:00:00.000Z",
      plainText: "시작 시 되돌릴 메모",
    });
    installLocalStorageStub({
      initialEntries: [
        [
          RESTORE_SAFETY_KEY,
          JSON.stringify({
            version: 1,
            source: "json",
            createdAt: "2026-07-12T12:01:00.000Z",
            payload: {
              version: 1,
              userId: "local",
              createdAt: "2026-07-12T12:01:00.000Z",
              memos: [memo],
            },
          }),
        ],
      ],
    });

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
    });
  });

  it("reloads canUndo from durable polling when the restore-safety event is lost", async () => {
    vi.useFakeTimers();
    try {
      const memo = createMemo({
        id: "memo-polling-undo",
        now: "2026-07-12T12:10:00.000Z",
        plainText: "폴링으로 찾을 웹 메모",
      });
      installLocalStorageStub({
        initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([memo])]],
      });

      render(<WebApp />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByDisplayValue("폴링으로 찾을 웹 메모")).toBeInTheDocument();

      window.localStorage.setItem(
        RESTORE_SAFETY_KEY,
        JSON.stringify({
          version: 1,
          source: "json",
          createdAt: "2026-07-12T12:11:00.000Z",
          payload: {
            version: 1,
            userId: "local",
            createdAt: "2026-07-12T12:11:00.000Z",
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

  it("treats malformed persisted undo storage as unavailable", async () => {
    installLocalStorageStub({
      initialEntries: [[RESTORE_SAFETY_KEY, JSON.stringify({ version: 1, source: "unknown" })]],
    });

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "H Memo" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "마지막 복원 되돌리기" })).not.toBeInTheDocument();
  });

  it("reloads durable undo when another browser window restores and ignores stale event data", async () => {
    const memo = createMemo({
      id: "memo-cross-window-undo",
      now: "2026-07-12T12:10:00.000Z",
      plainText: "다른 창에서 되돌릴 메모",
    });
    const storage = window.localStorage;
    render(<WebApp />);

    const safetyPoint = {
      version: 1,
      source: "server",
      createdAt: "2026-07-12T12:11:00.000Z",
      payload: {
        version: 1,
        userId: "user-1",
        createdAt: "2026-07-12T12:11:00.000Z",
        memos: [memo],
      },
    };
    storage.setItem(RESTORE_SAFETY_KEY, JSON.stringify(safetyPoint));
    act(() => {
      window.dispatchEvent(new Event("h-memo:restore-safety-changed"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
    });

    const stalePoint = { ...safetyPoint, createdAt: "2026-07-12T12:00:00.000Z" };
    const newerPoint = { ...safetyPoint, createdAt: "2026-07-12T12:12:00.000Z" };
    storage.setItem(RESTORE_SAFETY_KEY, JSON.stringify(newerPoint));
    act(() => {
      const staleEvent = new Event("storage") as StorageEvent;
      Object.defineProperties(staleEvent, {
        key: { configurable: true, value: RESTORE_SAFETY_KEY },
        newValue: { configurable: true, value: JSON.stringify(stalePoint) },
        storageArea: { configurable: true, value: storage },
      });
      window.dispatchEvent(staleEvent);
    });

    expect(JSON.parse(storage.getItem(RESTORE_SAFETY_KEY) ?? "null").createdAt).toBe(
      newerPoint.createdAt
    );
    expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
  });

  it("retains the browser undo point when undo replacement fails", async () => {
    const user = userEvent.setup();
    const currentMemo = createMemo({
      id: "memo-web-undo-failure-current",
      now: "2026-07-12T11:00:00.000Z",
      plainText: "undo 실패 전 메모",
    });
    const restoredMemo = createMemo({
      id: "memo-web-undo-failure-restored",
      now: "2026-07-12T11:01:00.000Z",
      plainText: "undo 실패 복원 메모",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([currentMemo])]],
    });
    const storage = window.localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    let failMemoWrites = false;
    storage.setItem = (key: string, value: string) => {
      if (failMemoWrites && key === LOCAL_MEMO_KEY) {
        throw new Error("undo storage failure");
      }
      originalSetItem(key, value);
    };

    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("undo 실패 전 메모")).toBeInTheDocument();
    });

    await user.upload(
      screen.getByLabelText("JSON 백업 파일 선택"),
      new File(
        [
          JSON.stringify({
            version: 1,
            userId: "local",
            createdAt: "2026-07-12T11:02:00.000Z",
            memos: [restoredMemo],
          }),
        ],
        "h-memo-backup.json",
        { type: "application/json" }
      )
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("undo 실패 복원 메모")).toBeInTheDocument();
    });

    const safetyPoint = storage.getItem(RESTORE_SAFETY_KEY);
    expect(safetyPoint).toBeTruthy();
    failMemoWrites = true;
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "마지막 복원 되돌리기" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("복원 되돌리기 실패:");
      expect(screen.getByDisplayValue("undo 실패 복원 메모")).toBeInTheDocument();
    });
    expect(storage.getItem(RESTORE_SAFETY_KEY)).toBe(safetyPoint);
    expect(screen.getByRole("button", { name: "마지막 복원 되돌리기" })).toBeInTheDocument();
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

  it("finishes an older mutation before publishing restore and reloads the remote tab", async () => {
    const restoreLocks = installExclusiveWebLocks();
    const initialMemo = createMemo({
      id: "web-cross-tab-shared",
      now: "2026-07-12T19:10:00.000Z",
      plainText: "두 탭의 복원 전 메모",
    });
    const restoredMemo = createMemo({
      id: initialMemo.id,
      now: "2026-07-12T19:11:00.000Z",
      plainText: "두 탭에 적용된 복원 메모",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([initialMemo])]],
    });
    const firstSave = deferred<void>();
    const originalSave = LocalStorageMemoRepository.prototype.saveMemo;
    let shouldDelayFirstSave = true;
    const saveSpy = vi
      .spyOn(LocalStorageMemoRepository.prototype, "saveMemo")
      .mockImplementation(async function (this: LocalStorageMemoRepository, memo) {
        if (shouldDelayFirstSave) {
          shouldDelayFirstSave = false;
          await firstSave.promise;
        }
        return originalSave.call(this, memo);
      });

    try {
      const firstTab = render(<WebApp />);
      const secondTab = render(<WebApp />);
      const firstView = within(firstTab.container);
      const secondView = within(secondTab.container);
      await waitFor(() => {
        expect(firstView.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
          "두 탭의 복원 전 메모"
        );
        expect(secondView.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
          "두 탭의 복원 전 메모"
        );
      });

      fireEvent.change(firstView.getByRole("textbox", { name: "메모 내용" }), {
        target: { value: "복원과 겹친 오래된 저장" },
      });
      await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
      fireEvent.change(firstView.getByRole("textbox", { name: "메모 내용" }), {
        target: { value: "복원 전에 큐에 남은 오래된 저장" },
      });

      const file = new File(
        [
          JSON.stringify({
            version: 1,
            userId: "local",
            createdAt: "2026-07-12T19:12:00.000Z",
            memos: [restoredMemo],
          }),
        ],
        "cross-tab-restore.json",
        { type: "application/json" }
      );
      fireEvent.change(
        secondView.getByLabelText("JSON 백업 파일 선택"),
        { target: { files: [file] } }
      );

      expect(
        firstView.getByRole("textbox", { name: "메모 내용" })
      ).not.toHaveAttribute("readonly");
      expect(window.localStorage.getItem(RESTORE_LEASE_KEY)).toBeNull();
      expect(window.localStorage.getItem(RESTORE_EPOCH_KEY)).toBeNull();
      expect(secondView.getByRole("status")).not.toHaveTextContent(
        "JSON 복원 완료"
      );

      await act(async () => {
        firstSave.resolve();
      });
      await waitFor(() => {
        expect(secondView.getByRole("status")).toHaveTextContent(
          "JSON 복원 완료: 1개 메모"
        );
        expect(firstView.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
          "두 탭에 적용된 복원 메모"
        );
        expect(
          firstView.getByRole("textbox", { name: "메모 내용" })
        ).not.toHaveAttribute("readonly");
      });
      expect(
        JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]").map(
          (memo: { id: string }) => memo.id
        )
      ).toEqual([restoredMemo.id]);
      expect(saveSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ plainText: "복원 전에 큐에 남은 오래된 저장" })
      );
    } finally {
      firstSave.resolve();
      saveSpy.mockRestore();
      restoreLocks();
    }
  });

  it("rejects an edit created after another tab advances the epoch but before its event arrives", async () => {
    const restoreLocks = installExclusiveWebLocks();
    const initialMemo = createMemo({
      id: "web-stale-event-order",
      now: "2026-07-12T19:20:00.000Z",
      plainText: "이벤트 전 오래된 화면",
    });
    const restoredMemo = createMemo({
      id: initialMemo.id,
      now: "2026-07-12T19:21:00.000Z",
      plainText: "다른 탭의 최종 복원",
    });
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([initialMemo])]],
    });
    const mutationLockEntered = deferred();
    const releaseMutationLock = deferred();

    try {
      render(<WebApp />);
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
          initialMemo.plainText
        );
      });

      const externalRestore = navigator.locks.request(
        "h-memo:web-mutation-v1",
        { mode: "exclusive" },
        async () => {
          mutationLockEntered.resolve();
          await releaseMutationLock.promise;
        }
      );
      await mutationLockEntered.promise;
      window.localStorage.setItem(RESTORE_EPOCH_KEY, "1");
      window.localStorage.setItem(LOCAL_MEMO_KEY, JSON.stringify([restoredMemo]));

      fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
        target: { value: "이벤트 전에 만든 stale 편집" },
      });
      releaseMutationLock.resolve();
      await externalRestore;

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent("오래된 메모 변경");
      });
      expect(
        JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]")[0]
          .plainText
      ).toBe(restoredMemo.plainText);

      act(() => {
        window.dispatchEvent(new Event("h-memo:web-memo-storage-changed"));
      });
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
          restoredMemo.plainText
        );
      });
    } finally {
      releaseMutationLock.resolve();
      restoreLocks();
    }
  });

  it("reloads repository state before observing an epoch-only storage event", async () => {
    const initialMemo = createMemo({
      id: "web-epoch-only-reload",
      now: "2026-07-12T19:30:00.000Z",
      plainText: "epoch 이벤트 전 메모",
    });
    const reconciledMemo = {
      ...initialMemo,
      plainText: "epoch 이벤트로 다시 읽은 메모",
      updatedAt: "2026-07-12T19:31:00.000Z",
    };
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([initialMemo])]],
    });
    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
        initialMemo.plainText
      );
    });

    window.localStorage.setItem(RESTORE_EPOCH_KEY, "1");
    window.localStorage.setItem(LOCAL_MEMO_KEY, JSON.stringify([reconciledMemo]));
    act(() => {
      const event = new Event("storage") as StorageEvent;
      Object.defineProperty(event, "key", {
        configurable: true,
        value: RESTORE_EPOCH_KEY,
      });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
        reconciledMemo.plainText
      );
    });
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "재조정 뒤 허용된 편집" },
    });
    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]")[0]
          .plainText
      ).toBe("재조정 뒤 허용된 편집");
    });
  });

  it("fails closed when one legacy localStorage record is corrupt", async () => {
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
      expect(screen.getByRole("status")).toHaveTextContent(
        "로컬 메모 저장소 데이터를 읽을 수 없습니다"
      );
    });
    expect(screen.queryByDisplayValue("windowState가 없어도 렌더링됩니다.")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("무시될 메모")).not.toBeInTheDocument();
  });

  it("reports localStorage write failures when creating a memo", async () => {
    const user = userEvent.setup();
    installLocalStorageStub({ failOnSet: true });
    render(<WebApp />);

    await createMemoFromAppMenu(user);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /메모 저장 실패: localStorage 저장 실패: quota exceeded/
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
      snapshotId: "restore-1",
      outcome: "created",
      cleanupPending: false,
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

  it("holds the local mutation barrier while server backup is running", async () => {
    const user = userEvent.setup();
    const currentMemo = createMemo({
      id: "web-backup-barrier-memo",
      now: "2026-07-12T16:00:00.000Z",
      plainText: "백업 중에도 유지할 메모",
    });
    const pendingBackup = deferred<Awaited<ReturnType<typeof backupMemos>>>();
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([currentMemo])]],
    });
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    vi.mocked(backupMemos).mockReturnValue(pendingBackup.promise);

    render(<WebApp />);
    await waitFor(() => expect(screen.getByRole("button", { name: "서버 백업" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "서버 백업" }));
    await waitFor(() => expect(backupMemos).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "백업 중 겹친 변경" },
    });
    await Promise.resolve();

    expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
      "백업 중에도 유지할 메모"
    );
    expect(JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]")[0].plainText).toBe(
      "백업 중에도 유지할 메모"
    );

    pendingBackup.resolve({
      path: "users/user-1/backupSnapshots/barrier",
      snapshotId: "barrier",
      outcome: "created",
      cleanupPending: false,
      payload: {
        version: 1,
        userId: LOGGED_IN_USER.uid,
        createdAt: "2026-07-12T16:01:00.000Z",
        memos: [currentMemo],
      },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(SUCCESS_BACKUP_MESSAGE));
  });

  it("holds the local mutation barrier while confirmed server delete is running", async () => {
    const user = userEvent.setup();
    const currentMemo = createMemo({
      id: "web-delete-barrier-memo",
      now: "2026-07-12T16:10:00.000Z",
      plainText: "삭제 중에도 유지할 메모",
    });
    const pendingDelete = deferred<number>();
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify([currentMemo])]],
    });
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    vi.mocked(deleteBackedUpMemo).mockReturnValue(pendingDelete.promise);

    render(<WebApp />);
    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    await user.click(screen.getByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" }));
    await waitFor(() => expect(deleteBackedUpMemo).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: "삭제 중 겹친 변경" },
    });
    await Promise.resolve();

    expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveValue(
      "삭제 중에도 유지할 메모"
    );
    expect(JSON.parse(window.localStorage.getItem(LOCAL_MEMO_KEY) ?? "[]")[0].plainText).toBe(
      "삭제 중에도 유지할 메모"
    );

    pendingDelete.resolve(1);
    await waitFor(() =>
      expect(within(screen.getByRole("dialog", { name: "서버 메모 관리" })).getByRole("status"))
        .toHaveTextContent("서버 메모를 삭제했습니다.")
    );
  });

  it("does not execute server delete after a declined confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<WebApp />);
    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    await user.click(screen.getByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" }));

    expect(deleteBackedUpMemo).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("dialog", { name: "서버 메모 관리" })).getByRole("status")
    ).toHaveTextContent("서버 메모 삭제를 취소했습니다.");
  });

  it("does not start server backup while a server restore owns the mutation barrier", async () => {
    const user = userEvent.setup();
    const pendingRestoreRead = deferred<ReturnType<typeof createMemo>[]>();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    render(<WebApp />);
    await user.click(screen.getByLabelText("앱 메뉴"));
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    const restoreButton = await screen.findByRole("button", {
      name: "서버에서 가져온 웹 메모 복원",
    });
    const listMemosSpy = vi
      .spyOn(LocalStorageMemoRepository.prototype, "listMemos")
      .mockImplementationOnce(async () => pendingRestoreRead.promise);

    fireEvent.click(restoreButton);
    fireEvent.click(screen.getByRole("button", { name: "서버 백업" }));

    expect(backupMemos).not.toHaveBeenCalled();
    pendingRestoreRead.resolve([]);
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog", { name: "서버 메모 관리" })).getByRole("status")
      ).toHaveTextContent("서버 메모 복원 완료")
    );
    listMemosSpy.mockRestore();
  });

  it("rechecks the restore barrier after server delete confirmation", async () => {
    const pendingRestoreRead = deferred<ReturnType<typeof createMemo>[]>();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(listBackedUpMemos).mockResolvedValue([SERVER_BACKED_UP_MEMO]);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });

    render(<WebApp />);
    fireEvent.click(screen.getByLabelText("앱 메뉴"));
    fireEvent.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    const restoreButton = await screen.findByRole("button", {
      name: "서버에서 가져온 웹 메모 복원",
    });
    const deleteButton = screen.getByRole("button", {
      name: "서버에서 가져온 웹 메모 서버 삭제",
    });
    const listMemosSpy = vi
      .spyOn(LocalStorageMemoRepository.prototype, "listMemos")
      .mockImplementationOnce(async () => pendingRestoreRead.promise);
    vi.mocked(window.confirm).mockImplementation(() => {
      fireEvent.click(restoreButton);
      return true;
    });

    fireEvent.click(deleteButton);

    expect(deleteBackedUpMemo).not.toHaveBeenCalled();
    pendingRestoreRead.resolve([]);
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog", { name: "서버 메모 관리" })).getByRole("status")
      ).toHaveTextContent("서버 메모 복원 완료")
    );
    listMemosSpy.mockRestore();
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
    const summary: BackupSnapshotSummary = {
      id: "selected-snapshot",
      savedAt: "2026-05-13T10:05:00.000Z",
      kstDate: "2026-05-13",
      memoCount: restoredPayload.memos.length,
      previewText: "복원된 본문",
      contentHash: null,
      schemaVersion: 1,
      state: "complete",
      legacyUndated: false,
    };
    vi.mocked(listBackupSnapshotSummaryPage).mockResolvedValue({
      summaries: [summary],
      nextCursor: null,
    });
    vi.mocked(loadBackupSnapshot).mockResolvedValue(restoredPayload);

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
            {
              id: "local-deleted-memo",
              title: "삭제된 로컬 메모",
              plainText: "복원 전에 이미 삭제된 데이터",
              createdAt: "2026-05-13T09:01:00.000Z",
              updatedAt: "2026-05-13T09:06:00.000Z",
              windowState: {
                x: null,
                y: null,
                width: 320,
                height: 280,
                visible: false,
                alwaysOnTop: false,
              },
              style: {
                backgroundColor: "#fff7b8",
                textColor: "#1f2937",
                fontFamily: "Malgun Gothic, Segoe UI, sans-serif",
                fontSize: 16,
              },
              syncState: "local-only",
              deletedAt: "2026-05-13T09:07:00.000Z",
              richContent: { type: "doc", content: [{ type: "paragraph" }] },
            },
          ]),
        ],
      ],
    });

    const storage = window.localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    let safetyAtFirstMutation: string | null = null;
    storage.setItem = (key: string, value: string) => {
      if (key === LOCAL_MEMO_KEY && safetyAtFirstMutation === null) {
        safetyAtFirstMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      originalSetItem(key, value);
    };

    render(<WebApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("삭제되어야 할 로컬 데이터")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "서버 복원" }));

    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    expect(listBackupSnapshotSummaryPage).toHaveBeenCalledOnce();
    expect(loadBackupSnapshot).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/백업 시각: 2026\. 5\. 13\. 오후 7:05:00/)).toBeInTheDocument();
    expect(within(dialog).queryByText("2030-05-13T10:05:00.000Z")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("삭제되어야 할 로컬 데이터")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "2026-05-13 백업 복원" })
    );

    await waitFor(() => {
      expect(loadBackupSnapshot).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        summary.id
      );
      expect(screen.queryByDisplayValue("삭제되어야 할 로컬 데이터")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("복원된 본문")).toBeInTheDocument();
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("2026. 5. 13. 오후 7:05:00")
    );
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1개 메모"));
    const safetyPoint = JSON.parse(
      window.localStorage.getItem(RESTORE_SAFETY_KEY) ?? "null"
    );
    expect(safetyPoint.source).toBe("server");
    expect(safetyPoint.payload.memos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "local-only-memo" }),
        expect.objectContaining({ id: "local-deleted-memo" }),
      ])
    );
    expect(safetyPoint.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      ["local-only-memo", "local-deleted-memo"].sort()
    );
    expect(safetyAtFirstMutation).toBe(JSON.stringify(safetyPoint));
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

  it("captures the complete browser state before individual server memo restore and undo", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    const currentMemo = createMemo({
      id: "web-individual-current",
      now: "2026-07-12T14:00:00.000Z",
      plainText: "복원 전 웹 메모",
    });
    const deletedMemo = {
      ...SERVER_BACKED_UP_MEMO.memo,
      deletedAt: "2026-07-12T14:01:00.000Z",
      windowState: { ...SERVER_BACKED_UP_MEMO.memo.windowState, visible: false },
    };
    const initialMemos = [currentMemo, deletedMemo];
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, JSON.stringify(initialMemos)]],
    });
    vi.mocked(listBackedUpMemos).mockResolvedValue([
      { memo: deletedMemo, backupCreatedAt: "2026-07-12T14:02:00.000Z" },
    ]);

    const storage = window.localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    let safetyAtFirstMutation: string | null = null;
    storage.setItem = (key: string, value: string) => {
      if (key === LOCAL_MEMO_KEY && safetyAtFirstMutation === null) {
        safetyAtFirstMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      originalSetItem(key, value);
    };

    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("복원 전 웹 메모")).toBeInTheDocument();
    });

    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    await user.click(
      await screen.findByRole("button", { name: "서버에서 가져온 웹 메모 복원" })
    );

    await waitFor(() => {
      expect(screen.getAllByDisplayValue("서버에서 가져온 웹 메모")).toHaveLength(1);
      expect(screen.getAllByRole("textbox", { name: "메모 내용" })).toHaveLength(2);
    });

    const safetyPoint = JSON.parse(storage.getItem(RESTORE_SAFETY_KEY) ?? "null");
    expect(safetyPoint.source).toBe("server");
    expect(safetyPoint.payload.memos.map((memo: { id: string }) => memo.id).sort()).toEqual(
      initialMemos.map((memo) => memo.id).sort()
    );
    expect(safetyAtFirstMutation).toBe(JSON.stringify(safetyPoint));

    let safetyAtUndoMutation: string | null = null;
    storage.setItem = (key: string, value: string) => {
      if (key === LOCAL_MEMO_KEY && safetyAtUndoMutation === null) {
        safetyAtUndoMutation = storage.getItem(RESTORE_SAFETY_KEY);
      }
      originalSetItem(key, value);
    };
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "마지막 복원 되돌리기" }));

    await waitFor(() => {
      expect(screen.getAllByRole("status").map((status) => status.textContent).join(" ")).toContain(
        "마지막 복원을 되돌렸습니다."
      );
      expect(screen.getByDisplayValue("복원 전 웹 메모")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("서버에서 가져온 웹 메모")).not.toBeInTheDocument();
    expect(safetyAtUndoMutation).toBe(JSON.stringify(safetyPoint));
    expect(storage.getItem(RESTORE_SAFETY_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(LOCAL_MEMO_KEY) ?? "[]").map((memo: { id: string }) => memo.id).sort()).toEqual(
      initialMemos.map((memo) => memo.id).sort()
    );
  });

  it("does not mutate browser memos when individual server restore safety storage fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
    vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
      callback(LOGGED_IN_USER);
      return vi.fn();
    });
    const currentMemo = createMemo({
      id: "web-individual-failure-current",
      now: "2026-07-12T15:00:00.000Z",
      plainText: "저장 실패에도 유지할 웹 메모",
    });
    const deletedMemo = {
      ...SERVER_BACKED_UP_MEMO.memo,
      deletedAt: "2026-07-12T15:01:00.000Z",
      windowState: { ...SERVER_BACKED_UP_MEMO.memo.windowState, visible: false },
    };
    const initialRaw = JSON.stringify([currentMemo, deletedMemo]);
    installLocalStorageStub({
      initialEntries: [[LOCAL_MEMO_KEY, initialRaw]],
      failOnSet: true,
    });
    vi.mocked(listBackedUpMemos).mockResolvedValue([
      { memo: deletedMemo, backupCreatedAt: "2026-07-12T15:02:00.000Z" },
    ]);

    render(<WebApp />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("저장 실패에도 유지할 웹 메모")).toBeInTheDocument();
    });
    await user.click(screen.getAllByLabelText("메모 메뉴")[0]!);
    await user.click(screen.getByRole("button", { name: "서버 메모 관리" }));
    await user.click(
      await screen.findByRole("button", { name: "서버에서 가져온 웹 메모 복원" })
    );

    await waitFor(() => {
      expect(screen.getAllByRole("status").map((status) => status.textContent).join(" ")).toContain(
        "서버 메모 복원 실패"
      );
      expect(screen.getByDisplayValue("저장 실패에도 유지할 웹 메모")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("서버에서 가져온 웹 메모")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_MEMO_KEY)).toBe(initialRaw);
    expect(screen.queryByRole("button", { name: "마지막 복원 되돌리기" })).not.toBeInTheDocument();
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

  it("reconciles the server list and reports a stale delete when delete API returns 0", async () => {
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
      expect(listBackedUpMemos).toHaveBeenCalledTimes(2);
      expect(within(dialog).getByRole("button", { name: "서버에서 가져온 웹 메모 서버 삭제" })).toBeInTheDocument();
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        '서버 백업에서 "서버에서 가져온 웹 메모" 메모를 삭제하지 못했습니다. 서버 목록을 새로고침했습니다.'
      );
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
