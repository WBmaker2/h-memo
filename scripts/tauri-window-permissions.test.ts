import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REQUIRED_WINDOW_PERMISSIONS = [
  "core:window:allow-close",
  "core:window:allow-hide",
  "core:window:allow-set-position",
  "core:window:allow-set-size",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
  "core:webview:allow-create-webview-window",
];

describe("Tauri window permissions", () => {
  it("allows the custom titlebar and dynamic memo windows to use native window APIs", () => {
    const capabilityPath = path.resolve(
      "apps",
      "desktop",
      "src-tauri",
      "capabilities",
      "default.json"
    );
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      permissions?: unknown;
      windows?: unknown;
    };

    expect(capability.windows).toEqual(["*"]);
    expect(capability.permissions).toEqual(
      expect.arrayContaining(REQUIRED_WINDOW_PERMISSIONS)
    );
  });
});
