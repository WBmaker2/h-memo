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
  const webviewWindowState: {
    createdOptions: Record<string, unknown> | null;
    createdHandlers: Map<string, (event?: { payload?: unknown }) => void>;
  } = {
    createdOptions: null,
    createdHandlers: new Map(),
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
    webviewWindowState,
  };
});

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
    }

    once(event: string, handler: (event?: { payload?: unknown }) => void) {
      webviewWindowState.createdHandlers.set(event, handler);
      if (event === "tauri://created") {
        handler();
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
});
