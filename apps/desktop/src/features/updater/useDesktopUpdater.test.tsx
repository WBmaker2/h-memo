import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import {
  useDesktopUpdater,
  type UseDesktopUpdaterOptions,
} from "./useDesktopUpdater";
import { UPDATE_SNOOZE_STORAGE_KEY } from "./updateSnooze";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

const mockCheck = vi.mocked(check);

function createUpdate() {
  const downloadAndInstall = vi.fn<(listener?: (event: DownloadEvent) => void) => Promise<void>>();
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const update = {
    currentVersion: "1.0.6",
    version: "1.0.7",
    date: "2026-08-30T00:00:00.000Z",
    body: "업데이트 설명",
    downloadAndInstall,
    close,
  } as unknown as Update;
  return { update, downloadAndInstall, close };
}

function UpdaterHarness({
  enabled = true,
  blocked = false,
}: Partial<UseDesktopUpdaterOptions>) {
  const state = useDesktopUpdater({ enabled, blocked });
  return (
    <div>
      <output data-testid="phase">{state.phase}</output>
      <output data-testid="version">{state.update?.version ?? ""}</output>
      <output data-testid="downloaded">{state.downloadedBytes}</output>
      <output data-testid="total">{state.totalBytes ?? ""}</output>
      <output data-testid="error">{state.errorMessage ?? ""}</output>
      <button type="button" onClick={() => void state.accept()}>
        accept
      </button>
      <button type="button" onClick={() => void state.decline()}>
        decline
      </button>
      <button type="button" onClick={() => void state.decline("week")}>
        snooze
      </button>
      <button type="button" onClick={() => void state.retry()}>
        retry
      </button>
    </div>
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDesktopUpdater", () => {
  it("waits for the startup gate and checks only once", async () => {
    mockCheck.mockResolvedValue(null);
    const { rerender } = render(<UpdaterHarness blocked />);

    expect(mockCheck).not.toHaveBeenCalled();
    rerender(<UpdaterHarness />);
    await waitFor(() => expect(mockCheck).toHaveBeenCalledOnce());
    rerender(<UpdaterHarness />);
    expect(mockCheck).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("idle"));
  });

  it("exposes an available update and closes it when declined", async () => {
    const { update, close } = createUpdate();
    mockCheck.mockResolvedValue(update);
    const user = userEvent.setup();
    render(<UpdaterHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("phase")).toHaveTextContent("available");
      expect(screen.getByTestId("version")).toHaveTextContent("1.0.7");
    });

    await user.click(screen.getByRole("button", { name: "decline" }));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("dismissed"));
    expect(close).toHaveBeenCalledOnce();
  });

  it("persists a selected snooze period and skips the next check", async () => {
    const { update, close } = createUpdate();
    mockCheck.mockResolvedValue(update);
    const user = userEvent.setup();
    render(<UpdaterHarness />);

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("available"));
    await user.click(screen.getByRole("button", { name: "snooze" }));

    expect(window.localStorage.getItem(UPDATE_SNOOZE_STORAGE_KEY)).not.toBeNull();
    expect(close).toHaveBeenCalledOnce();

    cleanup();
    mockCheck.mockClear();
    render(<UpdaterHarness />);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("dismissed"));
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("checks again after an expired snooze period", async () => {
    window.localStorage.setItem(UPDATE_SNOOZE_STORAGE_KEY, String(Date.now() - 1));
    mockCheck.mockResolvedValue(null);

    render(<UpdaterHarness />);

    await waitFor(() => expect(mockCheck).toHaveBeenCalledOnce());
    expect(window.localStorage.getItem(UPDATE_SNOOZE_STORAGE_KEY)).toBeNull();
  });

  it("reports download progress and remains installable until installation resolves", async () => {
    const { update, downloadAndInstall, close } = createUpdate();
    const installation = deferred<void>();
    downloadAndInstall.mockImplementation(async (listener) => {
      listener?.({ event: "Started", data: { contentLength: 100 } });
      listener?.({ event: "Progress", data: { chunkLength: 40 } });
      await installation.promise;
    });
    mockCheck.mockResolvedValue(update);
    const user = userEvent.setup();
    render(<UpdaterHarness />);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("available"));

    await user.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(screen.getByTestId("phase")).toHaveTextContent("installing");
      expect(screen.getByTestId("downloaded")).toHaveTextContent("40");
      expect(screen.getByTestId("total")).toHaveTextContent("100");
    });

    installation.resolve();
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("installed"));
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the update for a failed install and retries it", async () => {
    const { update, downloadAndInstall } = createUpdate();
    downloadAndInstall
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce(undefined);
    mockCheck.mockResolvedValue(update);
    const user = userEvent.setup();
    render(<UpdaterHarness />);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("available"));

    await user.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => {
      expect(screen.getByTestId("phase")).toHaveTextContent("error");
      expect(screen.getByTestId("error")).toHaveTextContent("업데이트를 설치하지 못했습니다.");
    });

    await user.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("installed"));
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("closes a pending update when the component unmounts", async () => {
    const { update, close } = createUpdate();
    mockCheck.mockResolvedValue(update);
    const { unmount } = render(<UpdaterHarness />);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("available"));

    unmount();
    expect(close).toHaveBeenCalledOnce();
  });
});
