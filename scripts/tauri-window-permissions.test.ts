import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REQUIRED_WINDOW_PERMISSIONS = [
  "core:window:allow-minimize",
  "core:window:allow-set-position",
  "core:window:allow-set-size",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
  "core:window:allow-toggle-maximize",
];

describe("Tauri window permissions", () => {
  it("allows the custom titlebar to move, resize, minimize, and maximize the memo window", () => {
    const capabilityPath = path.resolve(
      "apps",
      "desktop",
      "src-tauri",
      "capabilities",
      "default.json"
    );
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      permissions?: unknown;
    };

    expect(capability.permissions).toEqual(
      expect.arrayContaining(REQUIRED_WINDOW_PERMISSIONS)
    );
  });
});
