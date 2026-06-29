import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Windows Tauri workflow", () => {
  it("builds Windows artifacts without embedding OAuth client secret", () => {
    const workflow = readFileSync(
      path.resolve(".github", "workflows", "windows-tauri.yml"),
      "utf8"
    );

    expect(workflow).toContain("VITE_GOOGLE_OAUTH_CLIENT_ID:");
    expect(workflow).not.toContain("GOOGLE_OAUTH_CLIENT_SECRET:");
    expect(workflow).toContain("Ensure Windows Tauri CLI native binding");
    expect(workflow).toContain("@tauri-apps/cli-win32-x64-msvc@$tauriCliVersion");
  });
});
