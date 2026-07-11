import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  monitorFromPoint,
  PhysicalPosition,
  PhysicalSize,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Memo } from "@h-memo/memo-core";

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MemoWindowClaim = {
  claimed: boolean;
  shouldCreate: boolean;
  windowLabel: string;
  claimToken: string | null;
};

export function startWindowDrag() {
  return getCurrentWindow().startDragging();
}

export function startWindowResize(direction: "SouthEast") {
  return getCurrentWindow().startResizeDragging(direction);
}

export function closeWindow() {
  const currentWindow = getCurrentWindow();
  return currentWindow.label === "main" ? currentWindow.hide() : currentWindow.close();
}

export function getMemoWindowLabel(memoId: string) {
  return `memo_${memoId.replace(/[^a-zA-Z0-9-/:_]/g, "_")}`;
}

function getMemoWindowUrl(memoId: string) {
  return `index.html?memoId=${encodeURIComponent(memoId)}`;
}

async function focusMemoWindow(window: WebviewWindow) {
  await window.unminimize();
  await window.show();
  await window.setFocus();
}

async function claimMemoWindow(memoId: string, windowLabel: string) {
  return invoke<MemoWindowClaim>("claim_memo_window", { memoId, windowLabel });
}

async function completeMemoWindow(memoId: string, windowLabel: string, claimToken: string) {
  await invoke("complete_memo_window", { memoId, windowLabel, claimToken });
}

async function releaseMemoWindow(memoId: string, windowLabel: string, claimToken: string) {
  await invoke("release_memo_window", { memoId, windowLabel, claimToken });
}

export async function claimCurrentMemoWindow(memoId: string) {
  const windowLabel = getCurrentWindow().label;
  const claim = await claimMemoWindow(memoId, windowLabel);
  if (!claim.claimed || !claim.shouldCreate || !claim.claimToken) {
    return claim;
  }

  await completeMemoWindow(memoId, windowLabel, claim.claimToken);
  return {
    ...claim,
    shouldCreate: false,
  };
}

export function releaseCurrentMemoWindow(memoId: string, claimToken: string) {
  return releaseMemoWindow(memoId, getCurrentWindow().label, claimToken);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getMonitorWorkArea(monitor: Monitor) {
  return monitor.workArea ?? {
    position: monitor.position,
    size: monitor.size,
  };
}

function keepBoundsInsideMonitor(bounds: WindowBounds, monitor: Monitor): WindowBounds {
  const workArea = getMonitorWorkArea(monitor);
  const minX = workArea.position.x;
  const minY = workArea.position.y;
  const maxX = Math.max(minX, minX + workArea.size.width - bounds.width);
  const maxY = Math.max(minY, minY + workArea.size.height - bounds.height);

  return {
    ...bounds,
    x: clamp(bounds.x, minX, maxX),
    y: clamp(bounds.y, minY, maxY),
  };
}

async function readMonitor(
  loader: () => Promise<Monitor | null>
): Promise<Monitor | null> {
  try {
    return await loader();
  } catch {
    return null;
  }
}

async function getBestMonitorForBounds(bounds: WindowBounds) {
  return (
    (await readMonitor(() => monitorFromPoint(bounds.x, bounds.y))) ??
    (await readMonitor(() => currentMonitor())) ??
    (await readMonitor(() => primaryMonitor()))
  );
}

async function resolveVisibleWindowBounds(bounds: WindowBounds): Promise<WindowBounds> {
  const monitor = await getBestMonitorForBounds(bounds);
  return monitor ? keepBoundsInsideMonitor(bounds, monitor) : bounds;
}

export async function openMemoWindow(memo: Memo) {
  const label = getMemoWindowLabel(memo.id);
  const existingWindow = await WebviewWindow.getByLabel(label);
  if (existingWindow) {
    await focusMemoWindow(existingWindow);
    return;
  }

  const claim = await claimMemoWindow(memo.id, label);
  if (!claim.shouldCreate) {
    if (!claim.claimed) {
      const owner = await WebviewWindow.getByLabel(claim.windowLabel);
      if (owner) {
        await focusMemoWindow(owner);
      }
    }
    return;
  }

  if (!claim.claimToken) {
    throw new Error("Memo window reservation did not include a claim token.");
  }

  const claimToken = claim.claimToken;
  const safeBounds =
    memo.windowState.x !== null && memo.windowState.y !== null
      ? await resolveVisibleWindowBounds({
          x: memo.windowState.x,
          y: memo.windowState.y,
          width: memo.windowState.width,
          height: memo.windowState.height,
        })
      : null;

  try {
    const memoWindow = new WebviewWindow(label, {
      url: getMemoWindowUrl(memo.id),
      title: "H Memo",
      width: memo.windowState.width,
      height: memo.windowState.height,
      x: safeBounds?.x ?? undefined,
      y: safeBounds?.y ?? undefined,
      resizable: true,
      decorations: false,
      visible: true,
      focus: true,
    });

    await new Promise<void>((resolve, reject) => {
      void memoWindow.once("tauri://created", () => {
        void completeMemoWindow(memo.id, label, claimToken).then(resolve, reject);
      });
      void memoWindow.once("tauri://error", (event) => reject(event.payload));
    });
  } catch (error) {
    try {
      await releaseMemoWindow(memo.id, label, claimToken);
    } catch {
      // Preserve the window-construction failure as the actionable error.
    }
    throw error;
  }
}

export async function closeMemoWindow(memoId: string) {
  const memoWindow = await WebviewWindow.getByLabel(getMemoWindowLabel(memoId));
  if (!memoWindow) {
    return;
  }
  await memoWindow.close();
}

export async function readWindowBounds(): Promise<WindowBounds> {
  const currentWindow = getCurrentWindow();
  const [position, size] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.innerSize(),
  ]);

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

export async function restoreWindowBounds(bounds: {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}) {
  const currentWindow = getCurrentWindow();

  await currentWindow.setSize(new PhysicalSize(bounds.width, bounds.height));
  if (bounds.x !== null && bounds.y !== null) {
    const safeBounds = await resolveVisibleWindowBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    await currentWindow.setPosition(new PhysicalPosition(safeBounds.x, safeBounds.y));
  }
}

export async function setWindowHeight(height: number) {
  const currentWindow = getCurrentWindow();
  const size = await currentWindow.innerSize();
  await currentWindow.setSize(new PhysicalSize(size.width, height));
}

export async function listenWindowBoundsChanged(onChange: () => void) {
  const currentWindow = getCurrentWindow();
  const [unlistenMoved, unlistenResized] = await Promise.all([
    currentWindow.onMoved(onChange),
    currentWindow.onResized(onChange),
  ]);

  return () => {
    unlistenMoved();
    unlistenResized();
  };
}
