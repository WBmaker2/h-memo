import { describe, expect, it } from "vitest";
import { isWindowsDesktopUpdaterSupported } from "./platformSupport";

describe("isWindowsDesktopUpdaterSupported", () => {
  it("limits the public updater entry to Windows desktop runtimes", () => {
    expect(isWindowsDesktopUpdaterSupported(true, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true);
    expect(isWindowsDesktopUpdaterSupported(true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)")).toBe(false);
    expect(isWindowsDesktopUpdaterSupported(false, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});
