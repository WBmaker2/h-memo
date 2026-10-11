import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryMemoRepository, createMemo } from "@h-memo/memo-core";
import {
  readLocalSyncCheckpoint,
  type BackupGateway,
  type BackupSnapshotSummary,
  type MemoBackupPayload,
} from "@h-memo/memo-sync";
import { StartupServerRestoreDialog } from "@h-memo/memo-ui";
import {
  useDesktopStartupServerRestore,
  type UseDesktopStartupServerRestoreOptions,
} from "./features/startup-sync/useDesktopStartupServerRestore";
import { StartupSyncNotice } from "./features/startup-sync/StartupSyncNotice";

const USER = { uid: "startup-desktop-user" };

function createSummary(overrides: Partial<BackupSnapshotSummary> = {}): BackupSnapshotSummary {
  return {
    id: "desktop-server-snapshot-2030",
    savedAt: "2030-01-02T03:00:00.000Z",
    kstDate: "2030-01-02",
    memoCount: 1,
    previewText: "서버 최신 메모",
    contentHash: "b".repeat(64),
    schemaVersion: 3,
    state: "complete",
    legacyUndated: false,
    ...overrides,
  };
}

function createGateway(payload: MemoBackupPayload): BackupGateway {
  return {
    saveBackup: vi.fn(),
    listBackupSummaries: vi.fn().mockResolvedValue([]),
    loadBackup: vi.fn().mockResolvedValue(payload),
    loadCurrentMemos: vi.fn().mockResolvedValue([]),
    loadDeletedMemoIds: vi.fn().mockResolvedValue([]),
    deleteCurrentMemo: vi.fn().mockResolvedValue(0),
  };
}

function StartupHarness({
  options,
}: {
  options: UseDesktopStartupServerRestoreOptions;
}) {
  const state = useDesktopStartupServerRestore(options);
  return <>
    {state.dialog ? (
    <StartupServerRestoreDialog
      isOpen
      isBusy={state.isBusy}
      local={state.dialog.local}
      server={state.dialog.server}
      errorMessage={state.errorMessage}
      onAccept={state.accept}
      onDecline={state.decline}
    />
    ) : null}
    <output data-testid="startup-phase">{state.phase}</output>
    <StartupSyncNotice phase={state.phase} message={state.errorMessage} onRetry={state.retry} />
  </>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("desktop startup server restore", () => {
  it("limits the prompt to the main window and restores with the Enter default", async () => {
    const user = userEvent.setup();
    const localMemo = createMemo({
      id: "desktop-local-memo",
      now: "2026-08-28T01:00:00.000Z",
      plainText: "로컬 메모",
    });
    const serverMemo = createMemo({
      id: "desktop-server-memo",
      now: "2030-01-02T02:00:00.000Z",
      plainText: "서버 최신 메모",
    });
    const payload: MemoBackupPayload = {
      version: 1,
      userId: USER.uid,
      createdAt: "2030-01-02T03:00:00.000Z",
      memos: [serverMemo],
    };
    const gateway = createGateway(payload);
    const restoreServerMemos = vi.fn().mockResolvedValue(undefined);
    const getLatestServerSummary = vi.fn().mockResolvedValue(createSummary());
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository([localMemo]),
      storage: window.localStorage,
      getServices: () => ({ gateway }),
      getLatestServerSummary,
      restoreServerMemos,
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);
    await screen.findByRole("dialog", { name: "더 최근 서버 메모가 있습니다" });
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(restoreServerMemos).toHaveBeenCalledWith(USER.uid, payload);
      expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready");
    });
    expect(getLatestServerSummary).toHaveBeenCalled();
    expect(readLocalSyncCheckpoint(window.localStorage, USER.uid)).toMatchObject({
      snapshotId: "desktop-server-snapshot-2030",
    });
  });

  it("does not query or prompt in a child memo window", async () => {
    const getLatestServerSummary = vi.fn();
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: false,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository(),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary,
      restoreServerMemos: vi.fn(),
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);

    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("idle"));
    expect(getLatestServerSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("survives StrictMode effect replay without remaining stuck in checking", async () => {
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository(),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary: vi.fn().mockResolvedValue(null),
      restoreServerMemos: vi.fn(),
      onStatus: vi.fn(),
    };

    render(<StrictMode><StartupHarness options={options} /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready"));
  });

  it("ignores a late result after the signed-in account changes", async () => {
    let resolveFirst!: (value: BackupSnapshotSummary | null) => void;
    const firstResponse = new Promise<BackupSnapshotSummary | null>((resolve) => {
      resolveFirst = resolve;
    });
    const getLatestServerSummary = vi.fn((_gateway: BackupGateway, userId: string) =>
      userId === USER.uid ? firstResponse : Promise.resolve(null)
    );
    const baseOptions: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository(),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary,
      restoreServerMemos: vi.fn(),
      onStatus: vi.fn(),
    };

    const view = render(<StartupHarness options={baseOptions} />);
    await waitFor(() => expect(getLatestServerSummary).toHaveBeenCalledTimes(1));
    view.rerender(<StartupHarness options={{ ...baseOptions, user: { uid: "account-2" } }} />);
    await waitFor(() => expect(getLatestServerSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready"));
    resolveFirst(createSummary());

    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ends a pending server check after its timeout and ignores its late response", async () => {
    vi.useFakeTimers();
    let resolveServer!: (value: BackupSnapshotSummary | null) => void;
    const pendingServer = new Promise<BackupSnapshotSummary | null>((resolve) => {
      resolveServer = resolve;
    });
    const getLatestServerSummary = vi.fn().mockReturnValue(pendingServer);
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository(),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary,
      restoreServerMemos: vi.fn(),
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);
    await vi.waitFor(() => expect(getLatestServerSummary).toHaveBeenCalledTimes(1));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await vi.waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("error"));
    resolveServer(null);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("startup-phase")).toHaveTextContent("error");
  });

  it("exposes an explicit recheck after a failed server comparison", async () => {
    const user = userEvent.setup();
    const getLatestServerSummary = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository(),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary,
      restoreServerMemos: vi.fn(),
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);
    await screen.findByRole("button", { name: "서버 메모 다시 확인" });
    await user.click(screen.getByRole("button", { name: "서버 메모 다시 확인" }));

    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready"));
    expect(getLatestServerSummary).toHaveBeenCalledTimes(2);
  });

  it("stops automatic retries after three failed checks and can recover when connectivity returns", async () => {
    const getLatestServerSummary = vi.fn().mockRejectedValue(new Error("offline"));
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository(),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary,
      restoreServerMemos: vi.fn(),
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);
    await screen.findByRole("button", { name: "서버 메모 다시 확인" });
    await waitFor(() => expect(getLatestServerSummary).toHaveBeenCalledTimes(3), { timeout: 5000 });
    expect(screen.getByTestId("startup-phase")).toHaveTextContent("error");

    getLatestServerSummary.mockResolvedValueOnce(null);
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready"));
    expect(getLatestServerSummary).toHaveBeenCalledTimes(4);
  });

  it("does not restore when the server comparison becomes unknown after consent", async () => {
    const user = userEvent.setup();
    const getLatestServerSummary = vi.fn()
      .mockResolvedValueOnce(createSummary())
      .mockResolvedValueOnce(createSummary({ contentHash: null, savedAt: null }));
    const restoreServerMemos = vi.fn();
    const options: UseDesktopStartupServerRestoreOptions = {
      user: USER,
      isMainWindow: true,
      isServerReady: true,
      isRestoreLockReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository([
        createMemo({ id: "unknown-local", now: "2030-01-02T01:00:00.000Z" }),
      ]),
      storage: window.localStorage,
      getServices: () => ({ gateway: createGateway({
        version: 1,
        userId: USER.uid,
        createdAt: "2030-01-02T03:00:00.000Z",
        memos: [],
      }) }),
      getLatestServerSummary,
      restoreServerMemos,
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);
    await screen.findByRole("dialog", { name: "더 최근 서버 메모가 있습니다" });
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByTestId("startup-phase")).toHaveTextContent("error"));
    expect(restoreServerMemos).not.toHaveBeenCalled();
    expect(screen.getByText(/최신 서버 상태를 확인할 수 없어 복원을 중단했습니다/)).toBeInTheDocument();
  });
});
