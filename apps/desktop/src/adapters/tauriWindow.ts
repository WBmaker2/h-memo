import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Memo } from "@h-memo/memo-core";

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
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

export async function openMemoWindow(memo: Memo) {
  const label = getMemoWindowLabel(memo.id);
  const existingWindow = await WebviewWindow.getByLabel(label);
  if (existingWindow) {
    await existingWindow.unminimize();
    await existingWindow.show();
    await existingWindow.setFocus();
    return;
  }

  const memoWindow = new WebviewWindow(label, {
    url: getMemoWindowUrl(memo.id),
    title: "H Memo",
    width: memo.windowState.width,
    height: memo.windowState.height,
    x: memo.windowState.x ?? undefined,
    y: memo.windowState.y ?? undefined,
    resizable: true,
    decorations: false,
    visible: true,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    void memoWindow.once("tauri://created", () => resolve());
    void memoWindow.once("tauri://error", (event) => reject(event.payload));
  });
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
    await currentWindow.setPosition(new PhysicalPosition(bounds.x, bounds.y));
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
