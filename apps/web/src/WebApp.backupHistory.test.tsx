import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBackupPayload,
  createMemo,
  saveRestoreSafetyPoint,
  type RestoreSafetyPoint,
} from "@h-memo/memo-core";
import {
  type BackupSnapshotSummary,
  listBackupSnapshotSummaries,
  loadBackupSnapshot,
  subscribeAuthUser,
  completeGoogleRedirectSignIn,
  waitForSignedInUser,
  createFirebaseApp,
  getFirebaseAuth,
} from "@h-memo/memo-sync";
import { getFirebaseClientEnv } from "./env/firebaseEnv";
import { WebApp } from "./WebApp";

const LOCAL_MEMO_KEY = "h-memo:web-memo-repository-v1";
const RESTORE_SAFETY_KEY = "h-memo:restore-safety-v1";
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
const summary: BackupSnapshotSummary = {
  id: "selected-snapshot",
  savedAt: "2026-07-12T15:00:00.000Z",
  kstDate: "2026-07-13",
  memoCount: 0,
  previewText: "메모 없음",
  contentHash: null,
  schemaVersion: 1,
  state: "complete",
  legacyUndated: false,
};

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({})),
}));

vi.mock("@h-memo/memo-sync", async () => {
  const actual = await vi.importActual<typeof import("@h-memo/memo-sync")>("@h-memo/memo-sync");
  return {
    ...actual,
    createFirebaseApp: vi.fn(),
    getFirebaseAuth: vi.fn(),
    completeGoogleRedirectSignIn: vi.fn(),
    listBackupSnapshotSummaries: vi.fn(),
    loadBackupSnapshot: vi.fn(),
    subscribeAuthUser: vi.fn(),
    waitForSignedInUser: vi.fn(),
  };
});

vi.mock("./env/firebaseEnv", () => ({
  getFirebaseClientEnv: vi.fn(),
}));

function installWebLocks() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn(
        async (
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => Promise<unknown>
        ) => callback({ name: _name, mode: "exclusive" } as Lock)
      ),
    },
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(navigator, "locks", originalDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  };
}

const localMemo = createMemo({
  id: "local-memo",
  now: "2026-07-12T14:00:00.000Z",
  plainText: "복원 전 메모",
});

function seedLocalState() {
  window.localStorage.clear();
  window.localStorage.setItem(LOCAL_MEMO_KEY, JSON.stringify([localMemo]));
  const safetyPoint: RestoreSafetyPoint = {
    version: 1,
    source: "server",
    createdAt: "2026-07-12T14:01:00.000Z",
    payload: createBackupPayload({
      userId: "user-1",
      createdAt: "2026-07-12T14:00:00.000Z",
      memos: [localMemo],
    }),
  };
  saveRestoreSafetyPoint(window.localStorage, safetyPoint);
}

let restoreLocks: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  restoreLocks = installWebLocks();
  seedLocalState();
  vi.mocked(getFirebaseClientEnv).mockReturnValue(VALID_FIREBASE_ENV);
  vi.mocked(createFirebaseApp).mockReturnValue({} as never);
  vi.mocked(getFirebaseAuth).mockReturnValue({} as never);
  vi.mocked(subscribeAuthUser).mockImplementation((_auth, callback) => {
    callback(LOGGED_IN_USER);
    return vi.fn();
  });
  vi.mocked(completeGoogleRedirectSignIn).mockResolvedValue(null);
  vi.mocked(waitForSignedInUser).mockResolvedValue(null);
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });
});

afterEach(() => {
  cleanup();
  restoreLocks?.();
  restoreLocks = undefined;
});

describe("WebApp backup history failures", () => {
  it.each([
    ["null", async (): Promise<null> => null, "선택한 백업을 불러오지 못했습니다."],
    ["throw", async (): Promise<never> => { throw new Error("payload failed"); }, "payload failed"],
  ] as const)("keeps local state unchanged when selected payload returns %s", async (_kind, failure, message) => {
    const user = userEvent.setup();
    const localBefore = window.localStorage.getItem(LOCAL_MEMO_KEY);
    const safetyBefore = window.localStorage.getItem(RESTORE_SAFETY_KEY);
    vi.mocked(listBackupSnapshotSummaries).mockResolvedValue([summary]);
    vi.mocked(loadBackupSnapshot).mockImplementation(failure);

    render(<WebApp />);
    await waitFor(() => expect(screen.getByRole("button", { name: "서버 복원" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "서버 복원" }));
    const dialog = await screen.findByRole("dialog", { name: "백업 기록 선택" });
    expect(loadBackupSnapshot).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "2026-07-13 백업 복원" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(`복원 실패: ${message}`);
    });
    expect(loadBackupSnapshot).toHaveBeenCalledWith(expect.anything(), "user-1", summary.id);
    expect(window.localStorage.getItem(LOCAL_MEMO_KEY)).toBe(localBefore);
    expect(window.localStorage.getItem(RESTORE_SAFETY_KEY)).toBe(safetyBefore);
    expect(screen.getByDisplayValue("복원 전 메모")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "백업 기록 선택" })).toBeInTheDocument();
  });
});
