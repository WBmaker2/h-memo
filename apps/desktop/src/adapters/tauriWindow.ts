import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

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

export function minimizeWindow() {
  return getCurrentWindow().minimize();
}

export function toggleMaximizeWindow() {
  return getCurrentWindow().toggleMaximize();
}

export function closeWindow() {
  return invoke<void>("quit_app");
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
