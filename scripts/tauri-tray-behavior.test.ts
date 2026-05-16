import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Tauri tray behavior", () => {
  it("wires tray actions to open all memos and create a real memo", () => {
    const source = readFileSync(
      path.resolve("apps", "desktop", "src-tauri", "src", "lib.rs"),
      "utf8"
    );

    expect(source).toContain('"메모 모두 열기"');
    expect(source).toContain("TRAY_OPEN_ALL_MEMOS_EVENT");
    expect(source).toContain("TRAY_CREATE_MEMO_EVENT");
    expect(source).toContain("TrayIconEvent::DoubleClick");
    expect(source).not.toContain('"메모 열기"');
  });
});
