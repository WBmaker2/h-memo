import { getCurrentWindow } from "@tauri-apps/api/window";

export function startWindowDrag() {
  return getCurrentWindow().startDragging();
}

export function startWindowResize(direction: "SouthEast") {
  return getCurrentWindow().startResizeDragging(direction);
}
