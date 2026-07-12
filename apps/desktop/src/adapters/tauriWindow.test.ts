import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemo } from "@h-memo/memo-core";

const {
  mockCurrentMonitor,
  mockMonitorFromPoint,
  mockPrimaryMonitor,
  mockGetByLabel,
  mockSetSize,
  mockSetPosition,
  mockUnminimize,
  mockShow,
  mockSetFocus,
  mockInvoke,
  webviewWindowState,
} = vi.hoisted(() => {
  const mockCurrentMonitor = vi.fn();
  const mockMonitorFromPoint = vi.fn();
  const mockPrimaryMonitor = vi.fn();
  const mockGetByLabel = vi.fn();
  const mockSetSize = vi.fn();
  const mockSetPosition = vi.fn();
  const mockUnminimize = vi.fn();
  const mockShow = vi.fn();
  const mockSetFocus = vi.fn();
  const mockInvoke = vi.fn();
  const webviewWindowState: {
    createdOptions: Record<string, unknown> | null;
    createdHandlers: Map<string, (event?: { payload?: unknown }) => void>;
    constructorCalls: number;
    creationMode: "created" | "error" | "deferred";
  } = {
    createdOptions: null,
    createdHandlers: new Map(),
    constructorCalls: 0,
    creationMode: "created",
  };

  return {
    mockCurrentMonitor,
    mockMonitorFromPoint,
    mockPrimaryMonitor,
    mockGetByLabel,
    mockSetSize,
    mockSetPosition,
    mockUnminimize,
    mockShow,
    mockSetFocus,
    mockInvoke,
    webviewWindowState,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: Parameters<typeof mockInvoke>) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/window", () => {
  class PhysicalPosition {
    x: number;
    y: number;

    constructor(input: { x: number; y: number } | number, y?: number) {
      if (typeof input === "number") {
        this.x = input;
        this.y = y ?? 0;
        return;
      }

      this.x = input.x;
      this.y = input.y;
    }
  }

  class PhysicalSize {
    width: number;
    height: number;

    constructor(input: { width: number; height: number } | number, height?: number) {
      if (typeof input === "number") {
        this.width = input;
        this.height = height ?? 0;
        return;
      }

      this.width = input.width;
      this.height = input.height;
    }
  }

  return {
    PhysicalPosition,
    PhysicalSize,
    currentMonitor: () => mockCurrentMonitor(),
    monitorFromPoint: (x: number, y: number) => mockMonitorFromPoint(x, y),
    primaryMonitor: () => mockPrimaryMonitor(),
    getCurrentWindow: () => ({
      label: "main",
      setSize: mockSetSize,
      setPosition: mockSetPosition,
      startDragging: vi.fn(),
      startResizeDragging: vi.fn(),
      hide: vi.fn(),
      close: vi.fn(),
      outerPosition: vi.fn(),
      innerSize: vi.fn(),
      onMoved: vi.fn(),
      onResized: vi.fn(),
    }),
  };
});

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class WebviewWindow {
    static getByLabel = mockGetByLabel;

    constructor(_label: string, options: Record<string, unknown>) {
      webviewWindowState.createdOptions = options;
      webviewWindowState.constructorCalls += 1;
    }

    once(event: string, handler: (event?: { payload?: unknown }) => void) {
      webviewWindowState.createdHandlers.set(event, handler);
      if (event === "tauri://created" && webviewWindowState.creationMode === "created") {
        handler();
      }
      if (event === "tauri://error" && webviewWindowState.creationMode === "error") {
        handler({ payload: "window creation failed" });
      }
      return Promise.resolve(() => undefined);
    }
  }

  return { WebviewWindow };
});

describe("tauriWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webviewWindowState.createdOptions = null;
    webviewWindowState.createdHandlers.clear();
    webviewWindowState.constructorCalls = 0;
    webviewWindowState.creationMode = "created";
    mockCurrentMonitor.mockResolvedValue({
      name: "Primary",
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1040 },
      },
      scaleFactor: 1,
    });
    mockMonitorFromPoint.mockResolvedValue(null);
    mockPrimaryMonitor.mockResolvedValue({
      name: "Primary",
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1040 },
      },
      scaleFactor: 1,
    });
    mockGetByLabel.mockResolvedValue(null);
    mockInvoke.mockResolvedValue({
      claimed: true,
      shouldCreate: true,
      windowLabel: "memo-window",
      claimToken: "token-1",
    });
  });

  it("keeps restored memo windows inside the current monitor", async () => {
    const { restoreWindowBounds } = await import("./tauriWindow");

    await restoreWindowBounds({
      x: 5000,
      y: -2000,
      width: 430,
      height: 360,
    });

    expect(mockSetSize).toHaveBeenCalledWith(expect.objectContaining({
      width: 430,
      height: 360,
    }));
    expect(mockSetPosition).toHaveBeenCalledWith(expect.objectContaining({
      x: 1490,
      y: 0,
    }));
  });

  it("keeps newly opened memo windows inside the current monitor", async () => {
    const { openMemoWindow } = await import("./tauriWindow");
    const memo = createMemo({
      id: "memo-offscreen",
      now: "2026-06-09T09:00:00.000Z",
      windowState: {
        x: 5000,
        y: -2000,
        width: 430,
        height: 360,
      },
    });

    await openMemoWindow(memo);

    expect(webviewWindowState.createdOptions).toEqual(expect.objectContaining({
      x: 1490,
      y: 0,
      width: 430,
      height: 360,
    }));
  });

  it("focuses an existing memo window without changing its bounds", async () => {
    const { openMemoWindow } = await import("./tauriWindow");
    mockGetByLabel.mockResolvedValue({
      unminimize: mockUnminimize,
      show: mockShow,
      setFocus: mockSetFocus,
    });

    await openMemoWindow(createMemo({
      id: "memo-existing",
      now: "2026-06-09T09:00:00.000Z",
    }));

    expect(webviewWindowState.createdOptions).toBeNull();
    expect(mockUnminimize).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockSetFocus).toHaveBeenCalledTimes(1);
  });

  it("focuses the registered main owner instead of creating a duplicate memo window", async () => {
    const { openMemoWindow } = await import("./tauriWindow");
    mockInvoke.mockResolvedValue({
      claimed: false,
      shouldCreate: false,
      windowLabel: "main",
      claimToken: null,
    });
    mockGetByLabel.mockImplementation((label: string) =>
      Promise.resolve(
        label === "main"
          ? {
              unminimize: mockUnminimize,
              show: mockShow,
              setFocus: mockSetFocus,
            }
          : null
      )
    );

    await openMemoWindow(createMemo({
      id: "memo-1",
      now: "2026-07-11T09:00:00.000Z",
    }));

    expect(mockInvoke).toHaveBeenCalledWith("claim_memo_window", {
      memoId: "memo-1",
      windowLabel: "memo_memo-1",
    });
    expect(webviewWindowState.createdOptions).toBeNull();
    expect(mockUnminimize).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockSetFocus).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent child reservations so only the first caller creates the window", async () => {
    const { openMemoWindow } = await import("./tauriWindow");
    const memo = createMemo({ id: "memo-1", now: "2026-07-11T09:00:00.000Z" });
    webviewWindowState.creationMode = "deferred";
    let claimCount = 0;
    mockInvoke.mockImplementation((command: string) => {
      if (command === "claim_memo_window") {
        claimCount += 1;
        return Promise.resolve(
          claimCount === 1
            ? {
                claimed: true,
                shouldCreate: true,
                windowLabel: "memo_memo-1",
                claimToken: "token-1",
              }
            : {
                claimed: true,
                shouldCreate: false,
                windowLabel: "memo_memo-1",
                claimToken: null,
              }
        );
      }
      return Promise.resolve(undefined);
    });

    const openings = Promise.all([openMemoWindow(memo), openMemoWindow(memo)]);

    await vi.waitFor(() => {
      expect(webviewWindowState.constructorCalls).toBe(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
    webviewWindowState.createdHandlers.get("tauri://created")?.();
    await openings;

    expect(mockInvoke).toHaveBeenCalledWith("complete_memo_window", {
      memoId: "memo-1",
      windowLabel: "memo_memo-1",
      claimToken: "token-1",
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("release_memo_window", expect.anything());
  });

  it("releases exactly the matching pending token when child construction fails", async () => {
    const { openMemoWindow } = await import("./tauriWindow");
    webviewWindowState.creationMode = "error";
    mockInvoke.mockResolvedValueOnce({
      claimed: true,
      shouldCreate: true,
      windowLabel: "memo_memo-1",
      claimToken: "token-1",
    });

    await expect(openMemoWindow(createMemo({
      id: "memo-1",
      now: "2026-07-11T09:00:00.000Z",
    }))).rejects.toBe("window creation failed");

    expect(mockInvoke).toHaveBeenCalledWith("release_memo_window", {
      memoId: "memo-1",
      windowLabel: "memo_memo-1",
      claimToken: "token-1",
    });
  });

  it("does not construct a memo window when the native claim sees an active restore lease", async () => {
    const { openMemoWindow } = await import("./tauriWindow");
    mockInvoke.mockRejectedValueOnce(new Error("복원 잠금 중에는 메모 창을 열 수 없습니다."));

    await expect(
      openMemoWindow(createMemo({ id: "memo-locked", now: "2026-07-11T09:00:00.000Z" }))
    ).rejects.toThrow("복원 잠금");

    expect(webviewWindowState.constructorCalls).toBe(0);
  });
});
