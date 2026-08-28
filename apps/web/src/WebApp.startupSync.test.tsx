import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  useWebStartupServerRestore,
  type UseWebStartupServerRestoreOptions,
} from "./features/startup-sync/useWebStartupServerRestore";

const USER = { uid: "startup-web-user" };

function createSummary(): BackupSnapshotSummary {
  return {
    id: "server-snapshot-2030",
    savedAt: "2030-01-02T03:00:00.000Z",
    kstDate: "2030-01-02",
    memoCount: 1,
    previewText: "서버 최신 메모",
    contentHash: "b".repeat(64),
    schemaVersion: 3,
    state: "complete",
    legacyUndated: false,
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
  options: UseWebStartupServerRestoreOptions;
}) {
  const state = useWebStartupServerRestore(options);
  return state.dialog ? (
    <StartupServerRestoreDialog
      isOpen
      isBusy={state.isBusy}
      local={state.dialog.local}
      server={state.dialog.server}
      errorMessage={state.errorMessage}
      onAccept={state.accept}
      onDecline={state.decline}
    />
  ) : (
    <output data-testid="startup-phase">{state.phase}</output>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("WebApp startup server restore", () => {
  it("opens the prompt and restores the latest server payload with Enter", async () => {
    const user = userEvent.setup();
    const localMemo = createMemo({
      id: "local-memo",
      now: "2026-08-28T01:00:00.000Z",
      plainText: "로컬 메모",
    });
    const serverMemo = createMemo({
      id: "server-memo",
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
    const options: UseWebStartupServerRestoreOptions = {
      user: USER,
      isServerReady: true,
      hasLoadedMemos: true,
      repository: new MemoryMemoRepository([localMemo]),
      storage: window.localStorage,
      getServices: () => ({ gateway }),
      getLatestServerSummary: vi.fn().mockResolvedValue(createSummary()),
      getLocalFingerprint: (memos) => memos.map((memo) => memo.id).join(","),
      restoreServerMemos,
      onStatus: vi.fn(),
    };

    render(<StartupHarness options={options} />);

    await screen.findByRole("dialog", { name: "더 최근 서버 메모가 있습니다" });
    expect(
      screen.getByText("서버에 저장된 최근 버전의 메모를 불러오시겠습니까?")
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(restoreServerMemos).toHaveBeenCalledWith(USER.uid, payload);
      expect(screen.getByTestId("startup-phase")).toHaveTextContent("ready");
    });
    expect(readLocalSyncCheckpoint(window.localStorage, USER.uid)).toMatchObject({
      snapshotId: "server-snapshot-2030",
    });
  });
});
